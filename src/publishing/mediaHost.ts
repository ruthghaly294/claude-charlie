import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { resolveLocalMedia } from "./mediaDownload";

function contentTypeForExt(ext: string): string {
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

/**
 * Re-hosts ephemeral provider output (e.g. Replicate's `replicate.delivery` URLs,
 * which expire in ~1h) onto a durable, publicly-reachable URL so Buffer can still
 * fetch the media when a SCHEDULED reel publishes later. Without this, scheduled
 * posts error once the source URL expires.
 */
export interface MediaHost {
  /** Return a durable URL for `url`. Best-effort: on failure, returns `url` unchanged. */
  persist(url: string): Promise<string>;
}

/** Default: assume the provider's URL is already durable (e.g. MuAPI provider output). */
export const passthroughHost: MediaHost = {
  persist: async (url) => url,
};

export type MuapiExecResult = { stdout: string; stderr: string };
export type MuapiExec = (args: string[]) => Promise<MuapiExecResult>;

function defaultExec(args: string[]): Promise<MuapiExecResult> {
  return new Promise((resolve, reject) => {
    execFile("muapi", args, { timeout: 300_000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve({ stdout, stderr });
    });
  });
}

/** First http(s) URL in muapi's JSON (`{url}`/`{outputs:[…]}`) or raw stdout. */
function extractHostedUrl(stdout: string): string | null {
  try {
    const json = JSON.parse(stdout) as Record<string, unknown>;
    const direct = json.url ?? json.hosted_url ?? json.hostedUrl;
    if (typeof direct === "string" && /^https?:\/\//.test(direct)) return direct;
    const outputs = json.outputs;
    if (Array.isArray(outputs)) {
      const u = outputs.find((o) => typeof o === "string" && /^https?:\/\//.test(o));
      if (typeof u === "string") return u;
    }
  } catch {
    // not JSON — fall through
  }
  return stdout.match(/https?:\/\/\S+/)?.[0] ?? null;
}

export type MuapiHostOptions = {
  exec?: MuapiExec;
  resolve?: (ref: string) => Promise<string>;
  /** called when re-hosting fails and we fall back to the original URL. */
  onFallback?: (url: string, err: unknown) => void;
};

/**
 * Durable host backed by `muapi upload file` (uses the existing MuAPI key; needs a
 * MuAPI credit balance). Downloads the source URL, uploads it, returns the hosted
 * URL. On any failure it returns the original URL so publishing still proceeds.
 */
export function makeMuapiHost(opts: MuapiHostOptions = {}): MediaHost {
  const exec = opts.exec ?? defaultExec;
  const resolve = opts.resolve ?? ((ref: string) => resolveLocalMedia(ref));
  return {
    async persist(url) {
      try {
        // Remote URLs are downloaded to a local path first; local paths upload directly.
        const localPath = /^https?:\/\//i.test(url) ? await resolve(url) : url;
        const { stdout } = await exec(["upload", "file", localPath, "--output-json"]);
        return extractHostedUrl(stdout) ?? url;
      } catch (err) {
        opts.onFallback?.(url, err);
        return url;
      }
    },
  };
}

/** Bytes + content type fetched from a source media URL, ready to upload. */
export type FetchedMedia = { bytes: Uint8Array; contentType: string; ext: string };

/** Download a media URL into memory (used by the R2 host before upload). */
export async function fetchMediaBytes(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchedMedia> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`failed to download media (${res.status}): ${url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const ext = extname(new URL(url).pathname) || ".bin";
  const contentType = res.headers.get("content-type") ?? contentTypeForExt(ext);
  return { bytes, contentType, ext };
}

/** Read a local media file into memory (used by the R2 host for ffmpeg-produced clips). */
export async function readLocalMedia(path: string): Promise<FetchedMedia> {
  const bytes = new Uint8Array(await readFile(path));
  const ext = extname(path) || ".bin";
  return { bytes, contentType: contentTypeForExt(ext), ext };
}

/** True for a remote http(s) URL; false for a local filesystem path. */
function isRemoteUrl(ref: string): boolean {
  return /^https?:\/\//i.test(ref);
}

/** Uploads bytes under `key` and is responsible for making them publicly reachable. */
export type R2Uploader = (args: {
  key: string;
  bytes: Uint8Array;
  contentType: string;
}) => Promise<void>;

export type R2HostConfig = {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Public base URL for objects, e.g. an r2.dev domain or a custom domain (no trailing slash). */
  publicBaseUrl: string;
  /** Optional S3 API endpoint override (defaults to the account's r2.cloudflarestorage.com). */
  endpoint?: string;
};

export type R2HostOptions = {
  /** Inject for tests; default lazily loads `@aws-sdk/client-s3` and uploads to R2. */
  upload?: R2Uploader;
  fetchMedia?: (url: string) => Promise<FetchedMedia>;
  /** Inject for tests; default reads the local file from disk. */
  readLocal?: (path: string) => Promise<FetchedMedia>;
  onFallback?: (url: string, err: unknown) => void;
};

/** Default uploader: lazily imports the AWS S3 SDK (R2 is S3-compatible) and PUTs the object. */
export function makeS3Uploader(cfg: R2HostConfig): R2Uploader {
  return async ({ key, bytes, contentType }) => {
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = new S3Client({
      region: "auto",
      endpoint: cfg.endpoint ?? `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      // R2 mishandles AWS SDK v3's default flexible checksums (CRC32 headers/trailers),
      // which surfaces as a spurious 403; only send/validate checksums when required.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    await client.send(
      new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: bytes, ContentType: contentType }),
    );
  };
}

/**
 * Durable host backed by Cloudflare R2 (S3-compatible). Downloads the ephemeral
 * source URL, uploads it under a content-addressed key, and returns the public
 * `${publicBaseUrl}/${key}` URL — no per-upload credits, unlike MuAPI/Replicate.
 * Best-effort: on any failure it returns the original URL so publishing proceeds.
 */
export function makeR2Host(cfg: R2HostConfig, opts: R2HostOptions = {}): MediaHost {
  const upload = opts.upload ?? makeS3Uploader(cfg);
  const fetchMedia = opts.fetchMedia ?? ((url: string) => fetchMediaBytes(url));
  const base = cfg.publicBaseUrl.replace(/\/+$/, "");
  return {
    async persist(url) {
      try {
        // Remote URLs are fetched; local paths (e.g. ffmpeg caption-burn output) are read from disk.
        const { bytes, contentType, ext } = isRemoteUrl(url)
          ? await fetchMedia(url)
          : await (opts.readLocal ?? readLocalMedia)(url);
        const key = `trend-imitation/${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}${ext}`;
        await upload({ key, bytes, contentType });
        return `${base}/${key}`;
      } catch (err) {
        opts.onFallback?.(url, err);
        return url;
      }
    },
  };
}

/** Read R2 config from env (R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_BASE_URL). */
export function r2ConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): R2HostConfig | null {
  const accountId = env.R2_ACCOUNT_ID;
  const bucket = env.R2_BUCKET;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const publicBaseUrl = env.R2_PUBLIC_BASE_URL;
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey || !publicBaseUrl) return null;
  return { accountId, bucket, accessKeyId, secretAccessKey, publicBaseUrl, endpoint: env.R2_ENDPOINT };
}

/** Select the media host per config.trend_imitation.mediaHost ("r2" | "muapi" | "none"). */
export function getMediaHost(mediaHost: "r2" | "muapi" | "none"): MediaHost {
  if (mediaHost === "muapi") return makeMuapiHost();
  if (mediaHost === "r2") {
    const cfg = r2ConfigFromEnv();
    if (cfg) return makeR2Host(cfg);
    // R2 selected but unconfigured: fall back to passthrough rather than crash a run.
    return passthroughHost;
  }
  return passthroughHost;
}
