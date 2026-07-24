const DAY_MS = 24 * 60 * 60 * 1000;

function clean(value) {
  return value == null || value === "" ? "Unknown" : String(value);
}

export function classifyProduct(user) {
  const value = [user.product_id, user.trial_type, user.last_checkout_product]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/(2a|part[ _-]?2a)/.test(value)) return "2A FRCR";
  if (/physic/.test(value)) return "Physics";
  return "Unknown";
}

export function isPaid(user) {
  const status = String(user.subscription_status || "").toLowerCase();
  return /^(active|paid|subscribed|lifetime)$/.test(status)
    || (Number(user.checkout_count) > 0 && !user.is_trial_user && !/free|trial/.test(status));
}

export function formatSignup(user) {
  const paid = isPaid(user);
  const membership = paid ? "Paid" : user.is_trial_user ? "Free trial" : "Free";
  const lines = [
    "👤 New FRCR Bank signup",
    "",
    `User: ${clean(user.email)}`,
    `Product: ${classifyProduct(user)}`,
    `Membership: ${membership}`,
    `Trial member: ${user.is_trial_user ? "Yes" : "No"}`,
    `Paid: ${paid ? "Yes" : "No"}`,
    `Status: ${clean(user.subscription_status)}`,
    `Signed up: ${new Date(user.signed_up_at).toLocaleString("en-GB", { timeZone: "UTC" })} UTC`,
  ];
  return lines.join("\n");
}

export function formatSummary(users) {
  const paid = users.filter(isPaid).length;
  const trials = users.filter((user) => user.is_trial_user).length;
  const physics = users.filter((user) => classifyProduct(user) === "Physics").length;
  const part2a = users.filter((user) => classifyProduct(user) === "2A FRCR").length;
  const unknown = users.length - physics - part2a;
  const lines = [
    "📊 FRCR Bank signups — last 24 hours",
    "",
    `Total: ${users.length}`,
    `Free: ${users.length - paid} · Paid: ${paid}`,
    `Free trials: ${trials}`,
    `Physics: ${physics} · 2A FRCR: ${part2a}${unknown ? ` · Unknown: ${unknown}` : ""}`,
  ];
  if (users.length) {
    lines.push("", "Newest users:");
    for (const user of users.slice(0, 15)) {
      lines.push(`• ${clean(user.email)} — ${classifyProduct(user)}, ${isPaid(user) ? "paid" : user.is_trial_user ? "trial" : "free"}`);
    }
    if (users.length > 15) lines.push(`…and ${users.length - 15} more`);
  }
  return lines.join("\n");
}

export function createSignupMonitor({ env = process.env, fetchImpl = fetch, notify, now = () => Date.now() }) {
  const url = env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_KEY;
  const configured = Boolean(url && key);
  const seen = new Set();
  let initialized = false;

  async function list(hours = 24) {
    if (!configured) throw new Error("Supabase signup alerts are not configured");
    const endpoint = new URL(`${url}/rest/v1/trial_engagement_dashboard`);
    endpoint.searchParams.set("select", [
      "user_id", "email", "signed_up_at", "subscription_status", "is_trial_user",
      "trial_type", "product_id", "checkout_count", "last_checkout_mode", "last_checkout_product",
    ].join(","));
    endpoint.searchParams.set("signed_up_at", `gte.${new Date(now() - hours * 60 * 60 * 1000).toISOString()}`);
    endpoint.searchParams.set("order", "signed_up_at.desc");
    endpoint.searchParams.set("limit", "500");
    const response = await fetchImpl(endpoint, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || body.hint || `Supabase HTTP ${response.status}`);
    return body;
  }

  async function poll() {
    const users = await list(24);
    if (!initialized) {
      for (const user of users) seen.add(user.user_id);
      initialized = true;
      return 0;
    }
    const fresh = users.filter((user) => !seen.has(user.user_id)).reverse();
    for (const user of fresh) {
      await notify(formatSignup(user));
      seen.add(user.user_id);
    }
    const cutoff = now() - DAY_MS;
    for (const user of users) {
      if (new Date(user.signed_up_at).getTime() >= cutoff) seen.add(user.user_id);
    }
    return fresh.length;
  }

  return { configured, list, poll };
}
