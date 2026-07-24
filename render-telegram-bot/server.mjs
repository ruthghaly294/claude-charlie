import http from "node:http";
import { createSignupMonitor, formatSummary } from "./supabase-signups.mjs";

const port = Number(process.env.PORT || 10000);
const signupPollMs = Math.max(1, Number(process.env.SIGNUP_POLL_HOURS || 4)) * 60 * 60_000;
const telegramApi = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const bufferEndpoint = "https://api.buffer.com/graphql";
const seenDrafts = new Set();

async function jsonFetch(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok || json.ok === false || json.errors?.length) {
    throw new Error(json.description || json.errors?.map((e) => e.message).join("; ") || `HTTP ${response.status}`);
  }
  return json;
}

function telegram(method, body) {
  return jsonFetch(`${telegramApi}/${method}`, body);
}

const signupChatId = process.env.TELEGRAM_SIGNUP_CHAT_ID || process.env.TELEGRAM_REVIEW_CHAT_ID;
const signupMonitor = createSignupMonitor({
  notify: (text) => telegram("sendMessage", { chat_id: signupChatId, text }),
});

async function buffer(query, variables) {
  const json = await jsonFetch(bufferEndpoint, { query, variables }, {
    authorization: `Bearer ${process.env.BUFFER_ACCESS_TOKEN}`,
  });
  return json.data;
}

const fields = `id status text dueAt sentAt channelId channelService error { message } assets { type source thumbnail }`;

async function getPost(id) {
  const data = await buffer(`query($input: PostInput!){post(input:$input){${fields}}}`, { input: { id } });
  return data.post;
}

async function listDrafts() {
  const account = await buffer(`query{account{id organizations{id name}}}`, {});
  const organizationId = account.account.organizations[0]?.id;
  if (!organizationId) throw new Error("No Buffer organization found");
  const data = await buffer(
    `query($input: PostsInput!,$first:Int){posts(input:$input,first:$first){edges{node{${fields}}}}}`,
    { input: { organizationId, filter: { status: ["draft", "needs_approval"] } }, first: 50 },
  );
  return data.posts.edges.map((edge) => edge.node).filter((post) =>
    !process.env.BUFFER_CHANNEL_ID || post.channelId === process.env.BUFFER_CHANNEL_ID
  );
}

function keyboard(id) {
  return { inline_keyboard: [
    [{ text: "✅ Approve & publish", callback_data: `publish:${id}` }, { text: "🗓 Schedule", callback_data: `schedule:${id}` }],
    [{ text: "❌ Reject", callback_data: `delete:${id}` }],
  ] };
}

function scheduleKeyboard(id) {
  const now = Date.now();
  const at = (hours) => new Date(now + hours * 3_600_000).toISOString();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(9, 0, 0, 0);
  return { inline_keyboard: [
    [{ text: "In 1 hour", callback_data: `at:${id}:${at(1)}` }],
    [{ text: "In 3 hours", callback_data: `at:${id}:${at(3)}` }],
    [{ text: "Tomorrow 09:00 UTC", callback_data: `at:${id}:${tomorrow.toISOString()}` }],
    [{ text: "‹ Back", callback_data: `back:${id}` }],
  ] };
}

async function sendReview(post) {
  const images = post.assets.filter((asset) => asset.type === "image").map((asset) => asset.source);
  const video = post.assets.find((asset) => asset.type === "video");
  const preview = images.length ? images : video ? [video.thumbnail || video.source] : [];
  const caption = `🩻 FRCR Bank review\n\n${post.text}`.slice(0, 1024);
  if (preview.length > 1) {
    await telegram("sendMediaGroup", {
      chat_id: process.env.TELEGRAM_REVIEW_CHAT_ID,
      media: preview.slice(0, 10).map((media, index) => ({ type: "photo", media, ...(index === 0 ? { caption } : {}) })),
    });
    await telegram("sendMessage", {
      chat_id: process.env.TELEGRAM_REVIEW_CHAT_ID,
      text: "Review the carousel above, then choose what Buffer should do:",
      reply_markup: keyboard(post.id),
    });
  } else if (preview[0]) {
    await telegram("sendPhoto", {
      chat_id: process.env.TELEGRAM_REVIEW_CHAT_ID,
      photo: preview[0], caption, reply_markup: keyboard(post.id),
    });
  }
}

async function editPost(id, mode, dueAt) {
  const post = await getPost(id);
  const assets = post.assets.map((asset) => asset.type === "video"
    ? { video: { url: asset.source, ...(asset.thumbnail ? { thumbnailUrl: asset.thumbnail } : {}) } }
    : { image: { url: asset.source } });
  const data = await buffer(
    `mutation($input:EditPostInput!){editPost(input:$input){__typename ... on PostActionSuccess{post{${fields}}} ... on InvalidInputError{message} ... on NotFoundError{message} ... on UnauthorizedError{message} ... on UnexpectedError{message} ... on RestProxyError{message} ... on LimitReachedError{message}}}`,
    { input: { id, text: post.text, schedulingType: "automatic", mode, dueAt, assets, saveToDraft: false,
      metadata: { instagram: { type: post.assets.length > 1 || !post.assets.some((a) => a.type === "video") ? "post" : "reel", shouldShareToFeed: true } } } },
  );
  if (data.editPost.__typename !== "PostActionSuccess") throw new Error(data.editPost.message || "Buffer edit failed");
  return data.editPost.post;
}

async function deletePost(id) {
  const data = await buffer(`mutation($input:DeletePostInput!){deletePost(input:$input){__typename ... on DeletePostSuccess{id} ... on VoidMutationError{message}}}`, { input: { id } });
  if (data.deletePost.__typename !== "DeletePostSuccess") throw new Error(data.deletePost.message || "Buffer delete failed");
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function confirmPublication(id, chatId) {
  for (let attempt = 0; attempt < 18; attempt += 1) {
    const post = await getPost(id);
    if (post.status === "sent") {
      await telegram("sendMessage", {
        chat_id: chatId,
        text: `✅ Published successfully to Instagram via Buffer.\n\nBuffer post: ${id}\nSent: ${post.sentAt || "confirmed"}`,
      });
      return;
    }
    if (post.status === "error") {
      await telegram("sendMessage", {
        chat_id: chatId,
        text: `❌ Instagram publishing failed in Buffer.\n\nBuffer post: ${id}\n${post.error?.message || "Unknown Buffer error"}`,
      });
      return;
    }
    await wait(5_000);
  }
  await telegram("sendMessage", {
    chat_id: chatId,
    text: `⚠️ Buffer is still processing this Instagram post after 90 seconds.\n\nBuffer post: ${id}\nCheck Buffer before trying again.`,
  });
}

async function handleCallback(query) {
  const data = query.data || "";
  const first = data.indexOf(":");
  const second = data.indexOf(":", first + 1);
  const command = data.slice(0, first);
  const id = data.slice(first + 1, second < 0 ? undefined : second);
  const dueAt = second < 0 ? undefined : data.slice(second + 1);
  const message = query.message;
  if (String(message.chat.id) !== String(process.env.TELEGRAM_REVIEW_CHAT_ID)) throw new Error("Unauthorized chat");
  if (command === "schedule" || command === "back") {
    await telegram("editMessageReplyMarkup", { chat_id: message.chat.id, message_id: message.message_id,
      reply_markup: command === "schedule" ? scheduleKeyboard(id) : keyboard(id) });
    await telegram("answerCallbackQuery", { callback_query_id: query.id, text: command === "schedule" ? "Choose a time" : "Review options" });
    return;
  }
  if (command === "publish") await editPost(id, "shareNow");
  else if (command === "at") await editPost(id, "customScheduled", dueAt);
  else if (command === "delete") await deletePost(id);
  else throw new Error("Unknown action");
  await telegram("editMessageReplyMarkup", { chat_id: message.chat.id, message_id: message.message_id, reply_markup: { inline_keyboard: [] } });
  await telegram("answerCallbackQuery", { callback_query_id: query.id, text: command === "publish" ? "Approved — publishing via Buffer" : command === "at" ? `Scheduled for ${dueAt}` : "Rejected" });
  if (command === "publish") {
    void confirmPublication(id, message.chat.id).catch(async (error) => {
      console.error("Publish confirmation failed", error);
      await telegram("sendMessage", {
        chat_id: message.chat.id,
        text: `⚠️ Could not confirm the final Buffer status for ${id}. Please check Buffer.`,
      }).catch(() => undefined);
    });
  } else if (command === "at") {
    await telegram("sendMessage", {
      chat_id: message.chat.id,
      text: `🗓 Scheduled successfully in Buffer.\n\nBuffer post: ${id}\nPublish time: ${dueAt}`,
    });
  } else if (command === "delete") {
    await telegram("sendMessage", {
      chat_id: message.chat.id,
      text: `🗑 Rejected and removed from Buffer.\n\nBuffer post: ${id}`,
    });
  }
}

async function handleMessage(message) {
  const command = message.text?.trim().split(/\s+/)[0]?.split("@")[0];
  if (command !== "/signups") return;
  if (String(message.chat.id) !== String(process.env.TELEGRAM_REVIEW_CHAT_ID)) {
    await telegram("sendMessage", {
      chat_id: message.chat.id,
      text: `This chat is not authorized for signup data.\n\nChat ID: ${message.chat.id}\nConfigure this as TELEGRAM_REVIEW_CHAT_ID or use /signups in the FRCR Bank review chat.`,
    });
    return;
  }
  await telegram("sendChatAction", { chat_id: message.chat.id, action: "typing" });
  try {
    const users = await signupMonitor.list(24);
    await telegram("sendMessage", { chat_id: message.chat.id, text: formatSummary(users) });
  } catch (error) {
    console.error("Supabase /signups command failed", error);
    await telegram("sendMessage", {
      chat_id: message.chat.id,
      text: `⚠️ Could not fetch signups: ${error instanceof Error ? error.message : "unknown error"}`,
    });
  }
}

async function syncDrafts(seed = false) {
  const drafts = await listDrafts();
  for (const post of drafts) {
    if (!seenDrafts.has(post.id) && !seed) await sendReview(post);
    seenDrafts.add(post.id);
  }
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.url === "/health") return void response.end(JSON.stringify({ ok: true }));
    if (request.method !== "POST") {
      response.statusCode = 404; return void response.end("not found");
    }
    if (request.headers["x-telegram-bot-api-secret-token"] !== process.env.TELEGRAM_WEBHOOK_SECRET) {
      response.statusCode = 401; return void response.end("unauthorized");
    }
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const update = JSON.parse(raw || "{}");
    if (update.callback_query) await handleCallback(update.callback_query);
    else if (update.message) await handleMessage(update.message);
    response.end(JSON.stringify({ ok: true }));
  } catch (error) {
    console.error(error);
    response.statusCode = 500; response.end(JSON.stringify({ error: error.message }));
  }
});

server.listen(port, async () => {
  console.log(`FRCR Bank Telegram review service listening on ${port}`);
  try { await syncDrafts(true); } catch (error) { console.error("Initial Buffer sync failed", error); }
  setInterval(() => syncDrafts(false).catch((error) => console.error("Buffer sync failed", error)), 5 * 60_000).unref();
  if (signupMonitor.configured) {
    try { await signupMonitor.poll(); } catch (error) { console.error("Initial Supabase signup sync failed", error); }
    setInterval(() => signupMonitor.poll().catch((error) => console.error("Supabase signup sync failed", error)), signupPollMs).unref();
    console.log(`Supabase signup alerts checking every ${signupPollMs / 3_600_000} hour(s)`);
  } else {
    console.warn("Supabase signup alerts disabled: set SUPABASE_URL and SUPABASE_SECRET_KEY");
  }
});
