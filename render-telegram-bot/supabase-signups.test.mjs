import assert from "node:assert/strict";
import test from "node:test";
import { classifyProduct, createSignupMonitor, formatSignup, formatSummary, isPaid } from "./supabase-signups.mjs";

const trial = {
  user_id: "u1", email: "trial@example.com", signed_up_at: "2026-07-24T10:00:00Z",
  subscription_status: "trialing", is_trial_user: true, trial_type: "physics", product_id: null,
  checkout_count: 0, last_checkout_product: null,
};
const paid = {
  user_id: "u2", email: "paid@example.com", signed_up_at: "2026-07-24T11:00:00Z",
  subscription_status: "active", is_trial_user: false, trial_type: null, product_id: "frcr_part_2a",
  checkout_count: 1, last_checkout_product: "2A",
};

test("classifies product and payment state", () => {
  assert.equal(classifyProduct(trial), "Physics");
  assert.equal(classifyProduct(paid), "2A FRCR");
  assert.equal(isPaid(trial), false);
  assert.equal(isPaid(paid), true);
});

test("formats individual and 24-hour summary messages", () => {
  assert.match(formatSignup(trial), /Free trial/);
  assert.match(formatSignup(trial), /Physics/);
  const summary = formatSummary([paid, trial]);
  assert.match(summary, /Total: 2/);
  assert.match(summary, /Free: 1 · Paid: 1/);
  assert.match(summary, /Physics: 1 · 2A FRCR: 1/);
});

test("seeds existing rows and only notifies subsequent signups", async () => {
  let rows = [trial];
  const sent = [];
  const monitor = createSignupMonitor({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "secret" },
    fetchImpl: async () => ({ ok: true, json: async () => rows }),
    notify: async (text) => sent.push(text),
    now: () => Date.parse("2026-07-24T12:00:00Z"),
  });
  assert.equal(await monitor.poll(), 0);
  rows = [paid, trial];
  assert.equal(await monitor.poll(), 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /paid@example.com/);
});
