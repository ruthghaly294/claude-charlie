import { watchSchema } from "./watch-config.js";
import type { WatchStore } from "./watcher.js";
import { createHash, timingSafeEqual } from "node:crypto";
import Fastify, {
  LogController,
  type FastifyRequest,
  type FastifyReply,
} from "fastify";
import { searchQuerySchema, completedQuerySchema } from "./query.js";
import { parseSearchHtml } from "./parser.js";
import { createHtmlFetcher, type HtmlFetcher } from "./transport.js";
import { ScrapeError } from "./errors.js";

type Options = {
  readonly watchStore?: WatchStore;
  readonly fetchHtml?: HtmlFetcher;
  readonly apiKey?: string;
  readonly maxConcurrent?: number;
  readonly logger?: boolean;
};

export function buildApp(options: Options = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    logController: new LogController({ disableRequestLogging: true }),
    requestTimeout: 30000,
    bodyLimit: 1024,
  });
  const fetchHtml = options.fetchHtml ?? createHtmlFetcher();
  const maxConcurrent = options.maxConcurrent ?? 4;
  const keyHash = options.apiKey
    ? createHash("sha256").update(options.apiKey).digest()
    : null;
  let inFlight = 0;

  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
    reply.header("x-request-duration-ms", Math.round(reply.elapsedTime));
    reply.header("cache-control", "no-store");
    reply.header("x-content-type-options", "nosniff");
  });
  app.addHook("onResponse", async (request, reply) => {
    request.log.info(
      {
        requestId: request.id,
        status: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
      },
      "request completed",
    );
  });
  app.setErrorHandler((_error, _request, reply) => {
    void reply
      .code(500)
      .send({ code: "INTERNAL_ERROR", detail: "Request failed." });
  });

  const authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
    const supplied = request.headers["x-api-key"];
    if (
      keyHash &&
      (typeof supplied !== "string" ||
        !timingSafeEqual(
          keyHash,
          createHash("sha256").update(supplied).digest(),
        ))
    ) {
      return reply.code(401).send({
        code: "UNAUTHORIZED",
        detail: "A valid x-api-key is required.",
      });
    }
  };
  const handleSearch = async (request: FastifyRequest, reply: FastifyReply) => {
    const schema =
      request.routeOptions.url === "/v1/ebay/completed"
        ? completedQuerySchema
        : searchQuerySchema;
    const parsed = schema.safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send({
        code: "INVALID_QUERY",
        detail: parsed.error.issues
          .map(
            (issue) => `${issue.path.join(".") || "query"}: ${issue.message}`,
          )
          .join("; "),
      });
    if (inFlight >= maxConcurrent)
      return reply.header("retry-after", "1").code(429).send({
        code: "BUSY",
        detail: "Search concurrency limit reached. Try again shortly.",
      });
    inFlight++;
    const controller = new AbortController();
    const abort = (): void => {
      if (!reply.raw.writableEnded) controller.abort();
    };
    reply.raw.once("close", abort);
    try {
      const html = await fetchHtml(parsed.data, controller.signal);
      const result = parseSearchHtml(html, parsed.data);
      request.log.info(
        { requestId: request.id, resultCount: result.results.length },
        "search parsed",
      );
      return reply.send(result);
    } catch (error) {
      const code = error instanceof ScrapeError ? error.code : "INTERNAL_ERROR";
      const status = error instanceof ScrapeError ? error.statusCode : 500;
      const detail =
        error instanceof ScrapeError ? error.message : "Request failed.";
      request.log.warn(
        { requestId: request.id, code, status },
        "search failed",
      );
      return reply.code(status).send({ code, detail });
    } finally {
      inFlight--;
      reply.raw.removeListener("close", abort);
    }
  };
  app.get("/v1/ebay/search", { preHandler: authenticate }, handleSearch);
  app.get("/v1/ebay/completed", { preHandler: authenticate }, handleSearch);
  if (options.watchStore) {
    const store = options.watchStore;
    app.get("/v1/markets", { preHandler: authenticate }, () => ({
      profiles: ["chairs", "charizard_psa9_base"].map((profile) => ({
        profile,
        windows: [90, 180, 365].map((days) =>
          store.market(profile as "chairs" | "charizard_psa9_base", days),
        ),
      })),
    }));
    app.get("/v1/watches", { preHandler: authenticate }, () => ({
      searches: store.list(),
      alerts: store.status(),
    }));
    app.post(
      "/v1/watches",
      { preHandler: authenticate },
      async (request, reply) => {
        const parsed = watchSchema.safeParse(request.body);
        if (!parsed.success)
          return reply.code(400).send({ code: "INVALID_WATCH" });
        if (store.list().length >= 20)
          return reply.code(409).send({ code: "WATCH_LIMIT" });
        return reply.code(201).send(store.create(parsed.data));
      },
    );
    app.delete<{ Params: { id: string } }>(
      "/v1/watches/:id",
      { preHandler: authenticate },
      async (request, reply) =>
        store.remove(request.params.id)
          ? reply.code(204).send()
          : reply.code(404).send({ code: "NOT_FOUND" }),
    );
  }
  return app;
}
