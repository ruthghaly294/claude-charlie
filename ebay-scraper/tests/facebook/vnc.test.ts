import Fastify from "fastify";
import { expect, it } from "vitest";
import { installVncViewer } from "../../src/facebook/vnc.js";
it("requires a temporary secret and issues only a secure scoped browser cookie", async () => {
  const app = Fastify();
  await installVncViewer(app, {
    token: "x".repeat(32),
    expiresAt: Date.now() + 60000,
    origin: "https://example.test",
  });
  try {
    expect((await app.inject("/vnc/")).statusCode).toBe(200);
    await expect(
      app.injectWS("/vnc/socket", {
        headers: { origin: "https://example.test" },
      }),
    ).rejects.toThrow();
    expect((await app.inject("/vnc/login?token=wrong")).statusCode).toBe(401);
    const login = await app.inject("/vnc/login?token=" + "x".repeat(32));
    expect(login.statusCode).toBe(200);
    expect(login.body).toContain("Facebook sign-in desktop");
    expect(login.headers.location).toBeUndefined();
    expect(login.headers["set-cookie"]).toContain("HttpOnly");
    expect(login.headers["set-cookie"]).toContain("Secure");
    expect(login.headers["set-cookie"]).toContain("Path=/vnc");
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const page = await app.inject({ url: "/vnc/", headers: { cookie } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("Facebook sign-in desktop");
    await expect(
      app.injectWS("/vnc/socket", {
        headers: { cookie, origin: "https://attacker.test" },
      }),
    ).rejects.toThrow();
  } finally {
    await app.close();
  }
});
it("denies access after the login viewer expires", async () => {
  const app = Fastify();
  await installVncViewer(app, {
    token: "x".repeat(32),
    expiresAt: Date.now() - 1000,
    origin: "https://example.test",
  });
  try {
    expect(
      (await app.inject("/vnc/login?token=" + "x".repeat(32))).statusCode,
    ).toBe(401);
  } finally {
    await app.close();
  }
});
