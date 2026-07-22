import { readFileSync, writeFileSync } from "node:fs";

const statePath = process.env.TELEGRAM_REVIEW_STATE_PATH || ".github/telegram-review-state.json";
const endpoint = "https://api.buffer.com/graphql";
const telegramApi = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

async function post(url, body, headers = {}) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const json = await response.json();
  if (!response.ok || json.ok === false || json.errors?.length) throw new Error(json.description || json.errors?.map((e) => e.message).join("; ") || `HTTP ${response.status}`);
  return json;
}

async function buffer(query, variables) {
  return (await post(endpoint, { query, variables }, { authorization: `Bearer ${process.env.BUFFER_ACCESS_TOKEN}` })).data;
}

async function drafts() {
  const account = await buffer(`query{account{organizations{id}}}`, {});
  const organizationId = account.account.organizations[0]?.id;
  const fields = `id status text channelId assets { type source thumbnail }`;
  const data = await buffer(`query($input:PostsInput!,$first:Int){posts(input:$input,first:$first){edges{node{${fields}}}}}`, {
    input: { organizationId, filter: { status: ["draft", "needs_approval"] } }, first: 50,
  });
  return data.posts.edges.map((edge) => edge.node).filter((item) => !process.env.BUFFER_CHANNEL_ID || item.channelId === process.env.BUFFER_CHANNEL_ID);
}

function keyboard(id) {
  return { inline_keyboard: [[
    { text: "✅ Approve & publish", callback_data: `publish:${id}` },
    { text: "🗓 Schedule", callback_data: `schedule:${id}` },
  ], [{ text: "❌ Reject", callback_data: `delete:${id}` }]] };
}

async function send(item) {
  const images = item.assets.filter((asset) => asset.type === "image").map((asset) => asset.source);
  const video = item.assets.find((asset) => asset.type === "video");
  const previews = images.length ? images : video ? [video.thumbnail || video.source] : [];
  const caption = `🩻 FRCR Bank review\n\n${item.text}`.slice(0, 1024);
  if (previews.length > 1) {
    await post(`${telegramApi}/sendMediaGroup`, { chat_id: process.env.TELEGRAM_REVIEW_CHAT_ID,
      media: previews.slice(0, 10).map((media, index) => ({ type: "photo", media, ...(index === 0 ? { caption } : {}) })) });
    await post(`${telegramApi}/sendMessage`, { chat_id: process.env.TELEGRAM_REVIEW_CHAT_ID,
      text: "Review the carousel above, then choose what Buffer should do:", reply_markup: keyboard(item.id) });
  } else if (previews[0]) {
    await post(`${telegramApi}/sendPhoto`, { chat_id: process.env.TELEGRAM_REVIEW_CHAT_ID,
      photo: previews[0], caption, reply_markup: keyboard(item.id) });
  } else {
    throw new Error(`Buffer draft ${item.id} has no Telegram-compatible preview`);
  }
}

const state = JSON.parse(readFileSync(statePath, "utf8"));
const current = await drafts();
const seen = new Set(state.seen || []);
const forceLatest = process.env.FORCE_LATEST === "true";
let delivered = 0;
if (state.initialized) {
  for (const [index, item] of current.entries()) {
    if (!seen.has(item.id) || (forceLatest && index === 0)) {
      await send(item);
      delivered += 1;
    }
  }
}
for (const item of current) seen.add(item.id);
writeFileSync(statePath, `${JSON.stringify({ initialized: true, seen: [...seen].slice(-500) }, null, 2)}\n`);
console.log(`${state.initialized ? `Delivered ${delivered}` : "Seeded"} Buffer draft notification(s); tracking ${seen.size}.`);
