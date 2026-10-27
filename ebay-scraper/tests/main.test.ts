import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it } from "vitest";

describe("service process", () => {
  it("starts on loopback and handles a real HTTP request before graceful shutdown", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
      cwd: new URL("..", import.meta.url),
      env: { PATH: process.env["PATH"], HOST: "127.0.0.1", PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      const address = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("startup timed out")),
          5000,
        );
        child.once("exit", () => {
          clearTimeout(timer);
          reject(new Error("server exited before startup"));
        });
        child.stderr?.on("data", (data: Buffer) => {
          clearTimeout(timer);
          reject(new Error(data.toString()));
        });
        child.stdout?.on("data", (data: Buffer) => {
          const match = data.toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
          if (match) {
            clearTimeout(timer);
            resolve(match);
          }
        });
      });
      const reply = await fetch(`${address}/v1/ebay/search`);
      expect(reply.status).toBe(400);
      expect(await reply.json()).toMatchObject({ code: "INVALID_QUERY" });
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      expect((await exited)[0]).toBe(0);
    } finally {
      child.kill("SIGKILL");
    }
  });
});
