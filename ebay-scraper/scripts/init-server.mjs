import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
await mkdir(".server", { recursive: true, mode: 0o700 });
for (const [path, content] of [
  [".env.server", `SERVICE_API_KEY=${randomBytes(32).toString("hex")}\n`],
  [".server/vnc-password", randomBytes(6).toString("base64")],
]) {
  try { await writeFile(path, content, { flag: "wx", mode: 0o600 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
}
console.log("Server secrets ready; existing credentials were preserved. Never commit or share .env.server or .server/.");
