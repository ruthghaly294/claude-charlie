import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createBufferClient, resolveOrgId } from "../src/publishing/bufferClient";
function loadEnv(file = ".env.local") {
  const path = join(process.cwd(), file);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]!] !== undefined) continue;
    let v = m[2]!.trim(); if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1);
    process.env[m[1]!] = v;
  }
}
async function main() {
  loadEnv();
  const c = createBufferClient(process.env);
  const acct = await c.getAccount();
  console.log("account:", acct.id, "orgs:", acct.organizations.map((o) => o.name));
  const org = await resolveOrgId(c);
  const chans = await c.listChannels(org);
  for (const ch of chans) console.log("channel:", ch.id, ch.service, ch.name, ch.displayName);
  const post = await c.getPost("6a33ec0985980c2d68cf6bd5");
  console.log("post status:", post.status, "| error:", post.error, "| dueAt:", post.dueAt, "| sentAt:", post.sentAt, "| service:", post.channelService);
}
main().catch((e) => { console.error("ERR:", e.message); });
