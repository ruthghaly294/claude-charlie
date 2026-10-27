import { isAbsolute } from "node:path";
import { z } from "zod";

const configSchema = z
  .object({
    host: z.string().min(1).default("127.0.0.1"),
    port: z.coerce.number().int().min(0).max(65535).default(3001),
    timeoutMs: z.coerce.number().int().min(100).max(60000).default(45000),
    maxBytes: z.coerce
      .number()
      .int()
      .min(1024)
      .max(24 * 1024 * 1024)
      .default(12 * 1024 * 1024),
    maxConcurrent: z.coerce.number().int().min(1).max(32).default(4),
    apiKey: z.string().min(24).max(512).optional(),
    transport: z.enum(["chrome", "direct"]).default("chrome"),
    watchDb: z.string().refine(isAbsolute).optional(),
    telegramToken: z
      .string()
      .regex(/^\d+:[A-Za-z0-9_-]{20,}$/)
      .optional(),
    telegramChatId: z
      .string()
      .regex(/^-?\d+$/)
      .optional(),
    sessionImportFile: z.string().refine(isAbsolute).optional(),
    chromeExecutable: z.string().min(1).optional(),
    chromeProfile: z
      .string()
      .refine(isAbsolute, "Chrome profile must be absolute")
      .optional(),
    chromeHeadless: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    chromeCdp: z
      .url()
      .refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === "http:" &&
          ["127.0.0.1", "[::1]"].includes(url.hostname) &&
          url.username === "" &&
          url.password === "" &&
          url.pathname === "/" &&
          !url.search &&
          !url.hash
        );
      }, "Chrome CDP must be a credential-free loopback HTTP endpoint")
      .optional(),
    proxyUrl: z
      .url()
      .refine(
        (value) => /^https?:/.test(value),
        "Proxy URL must use HTTP or HTTPS",
      )
      .optional(),
  })
  .refine((config) => !(config.chromeProfile && config.chromeCdp), {
    message: "Choose a managed profile or external CDP, not both",
  })
  .refine(
    (config) =>
      ["127.0.0.1", "::1", "localhost"].includes(config.host) ||
      config.apiKey !== undefined,
    {
      path: ["apiKey"],
      message: "A service API key is required for non-loopback binding",
    },
  );

export function readConfig(env: NodeJS.ProcessEnv) {
  return configSchema.parse({
    ...(env["WATCH_DB"] ? { watchDb: env["WATCH_DB"] } : {}),
    ...(env["TELEGRAM_BOT_TOKEN"]
      ? { telegramToken: env["TELEGRAM_BOT_TOKEN"] }
      : {}),
    ...(env["TELEGRAM_CHAT_ID"]
      ? { telegramChatId: env["TELEGRAM_CHAT_ID"] }
      : {}),
    ...(env["EBAY_SESSION_IMPORT"]
      ? { sessionImportFile: env["EBAY_SESSION_IMPORT"] }
      : {}),
    host: env["HOST"],
    port: env["PORT"],
    timeoutMs: env["EBAY_TIMEOUT_MS"],
    maxBytes: env["EBAY_MAX_BYTES"],
    maxConcurrent: env["MAX_CONCURRENT"],
    ...(env["SERVICE_API_KEY"] ? { apiKey: env["SERVICE_API_KEY"] } : {}),
    ...(env["EBAY_PROXY_URL"] ? { proxyUrl: env["EBAY_PROXY_URL"] } : {}),
    transport: env["EBAY_TRANSPORT"],
    chromeHeadless: env["EBAY_CHROME_HEADLESS"],
    ...(env["EBAY_CHROME_PROFILE"]
      ? { chromeProfile: env["EBAY_CHROME_PROFILE"] }
      : {}),
    ...(env["EBAY_CHROME_EXECUTABLE"]
      ? { chromeExecutable: env["EBAY_CHROME_EXECUTABLE"] }
      : {}),
    ...(env["EBAY_CHROME_CDP"] ? { chromeCdp: env["EBAY_CHROME_CDP"] } : {}),
  });
}
