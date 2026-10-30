import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import websocket from "@fastify/websocket";
import serveStatic from "@fastify/static";
import { createHash, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import net from "node:net";

const viewer = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Facebook sign-in desktop</title>
<style>body{margin:0;background:#17212b;color:#fff;font:16px system-ui}header{padding:12px 20px}h1{font-size:18px;margin:0 0 6px}button{padding:8px 14px}#screen{height:calc(100vh - 105px)}#status{font-size:14px}</style>
<header><h1>Facebook sign-in desktop</h1><p id="status" role="status">Connecting to your dedicated server browser…</p><button id="reconnect" type="button">Reconnect</button></header><main id="screen" aria-label="Remote Chrome browser"></main>
<script type="module">import RFB from '/vnc/assets/core/rfb.js';const access=new URLSearchParams(location.hash.slice(1)).get('key')||new URLSearchParams(location.search).get('token');if(access)history.replaceState(null,'','/vnc/#key='+encodeURIComponent(access));let rfb;const status=document.querySelector('#status');function connect(){rfb?.disconnect();document.querySelector('#screen').replaceChildren();rfb=new RFB(document.querySelector('#screen'),'wss://'+location.host+'/vnc/socket'+(access?'?token='+encodeURIComponent(access):''));rfb.scaleViewport=true;rfb.resizeSession=false;rfb.addEventListener('credentialsrequired',()=>{const password=prompt('Remote desktop connection password (not your Facebook password):');if(password)rfb.sendCredentials({password});});rfb.addEventListener('connect',()=>{status.textContent='Sign into Facebook directly in the Chrome window below. You can close this page after signing in.';});rfb.addEventListener('disconnect',()=>{status.textContent='Desktop disconnected. Click Reconnect if you still need to sign in.';});rfb.addEventListener('securityfailure',()=>{status.textContent='Connection password was not accepted. Reconnect to try again.';});}document.querySelector('#reconnect').addEventListener('click',connect);connect();</script></html>`;

export async function installVncViewer(
  app: FastifyInstance,
  options: { token: string; expiresAt: number; origin: string; port?: number },
): Promise<void> {
  if (options.token.length < 32 || !Number.isFinite(options.expiresAt))
    throw new Error("Invalid temporary viewer configuration");
  const digest = (value: string) => createHash("sha256").update(value).digest();
  const expected = digest(options.token);
  const valid = (value: string) =>
    Date.now() < options.expiresAt && timingSafeEqual(expected, digest(value));
  const authorized = (request: FastifyRequest) => {
    const match = request.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("facebook_vnc="));
    const query = new URL(request.url, "http://localhost").searchParams.get(
      "token",
    );
    return valid(query ?? match?.slice("facebook_vnc=".length) ?? "");
  };
  const deny = async (request: FastifyRequest, reply: FastifyReply) => {
    reply
      .header("cache-control", "no-store")
      .header("referrer-policy", "no-referrer");
    if (request.url.startsWith("/vnc/socket") && !authorized(request))
      return reply.code(401).send({ code: "VIEWER_AUTH_REQUIRED" });
  };
  await app.register(websocket, { options: { maxPayload: 4 * 1024 * 1024 } });
  app.get<{ Querystring: { token?: string } }>(
    "/vnc/login",
    async (request, reply) => {
      reply
        .header("cache-control", "no-store")
        .header("referrer-policy", "no-referrer");
      if (!valid(request.query.token ?? ""))
        return reply.code(401).send({ code: "VIEWER_LINK_INVALID_OR_EXPIRED" });
      reply.header(
        "set-cookie",
        `facebook_vnc=${options.token}; Path=/vnc; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.max(0, Math.floor((options.expiresAt - Date.now()) / 1000))}`,
      );
      return reply.type("text/html").send(viewer);
    },
  );
  await app.register(async (scoped) => {
    scoped.addHook("onRequest", deny);
    const root = dirname(
      dirname(createRequire(import.meta.url).resolve("@novnc/novnc")),
    );
    await scoped.register(serveStatic, {
      root,
      prefix: "/vnc/assets/",
      index: false,
      dotfiles: "deny",
    });
    scoped.get("/vnc/", async (_request, reply) =>
      reply.type("text/html").send(viewer),
    );
    scoped.get(
      "/vnc/socket",
      {
        websocket: true,
        preValidation: async (request, reply) => {
          if (request.headers.origin !== options.origin)
            return reply.code(403).send({ code: "VIEWER_ORIGIN_DENIED" });
        },
      },
      (socket) => {
        const upstream = net.connect(options.port ?? 5900, "127.0.0.1");
        const timer = setTimeout(
          () => {
            socket.close(1000, "Login viewer expired");
            upstream.destroy();
          },
          Math.max(0, options.expiresAt - Date.now()),
        );
        timer.unref();
        socket.on("message", (data) => {
          if (!upstream.destroyed)
            upstream.write(
              Array.isArray(data)
                ? Buffer.concat(data)
                : Buffer.isBuffer(data)
                  ? data
                  : Buffer.from(data),
            );
        });
        upstream.on("data", (data) => {
          if (
            socket.readyState === 1 &&
            socket.bufferedAmount < 8 * 1024 * 1024
          )
            socket.send(data);
          else upstream.destroy();
        });
        upstream.on("error", () =>
          socket.close(1011, "Remote desktop is not ready"),
        );
        upstream.on("close", () => socket.close());
        socket.on("close", () => {
          clearTimeout(timer);
          upstream.destroy();
        });
        socket.on("error", () => {
          clearTimeout(timer);
          upstream.destroy();
        });
      },
    );
  });
}
