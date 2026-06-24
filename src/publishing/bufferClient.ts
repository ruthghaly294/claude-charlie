import { z } from "zod";

/**
 * Buffer's GraphQL API (the same surface the Buffer MCP server uses). Personal
 * access tokens are generated at https://publish.buffer.com/settings/api and
 * sent as a Bearer token. Note: graph.buffer.com rejects personal access
 * tokens with "Please use api.buffer.com" — api.buffer.com/graphql is the
 * correct endpoint for this auth mode. All endpoint/auth specifics live in
 * this file — if Buffer's personal-token auth changes again, only this file
 * needs to change.
 */
const BUFFER_GRAPHQL_ENDPOINT = "https://api.buffer.com/graphql";

export class BufferApiError extends Error {}

export type BufferEnv = Record<string, string | undefined>;

/** Injectable delay so the 429 backoff is instant in tests. */
export type SleepFn = (ms: number) => Promise<void>;
const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Total attempts on a transient HTTP 429 / network stall before giving up. */
const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 1000;
/**
 * Per-request timeout. Buffer can stall a connection indefinitely when it's
 * hard-throttling a token (no response, not even a 429); without this the daily
 * job would hang forever (it did — a 16-minute CI hang). Abort + retry instead.
 */
const REQUEST_TIMEOUT_MS = 20000;

/** How long to wait before retrying a throttled request — Retry-After header if present, else exponential. */
function retryDelayMs(res: Response, attempt: number): number {
  const header = res.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  }
  return BASE_BACKOFF_MS * 2 ** attempt;
}

export type BufferChannel = {
  id: string;
  name: string;
  displayName: string | null;
  service: string;
  avatar: string;
};

export type BufferPostStatus =
  | "draft"
  | "needs_approval"
  | "scheduled"
  | "sending"
  | "sent"
  | "error";

export type PostMetric = {
  type: string;
  name: string;
  value: number;
  unit: string;
};

export type BufferPost = {
  id: string;
  status: BufferPostStatus;
  text: string;
  dueAt: string | null;
  sentAt: string | null;
  channelId: string;
  channelService: string;
  error: string | null;
  metrics: PostMetric[];
  metricsUpdatedAt: string | null;
  imageUrl: string | null;
  /** All image asset URLs in order (a multi-image post is an Instagram carousel). */
  imageUrls: string[];
};

export type ComposeInput = {
  channelId: string;
  text: string;
  imageUrl?: string;
  /** Ordered image URLs for a multi-slide carousel. Used when instagramType === "carousel". */
  imageUrls?: string[];
  /** Short-form video asset URL (e.g. a Higgsfield clip). Takes precedence over imageUrl. */
  videoUrl?: string;
  /** Optional poster frame for the video. */
  thumbnailUrl?: string;
  altText?: string;
  dueAt?: string;
  shareNow?: boolean;
  instagramType?: "post" | "reel" | "story";
  /** Create the post in Buffer's "draft" status for human review before it queues/sends. */
  saveToDraft?: boolean;
};

export type BufferAccount = {
  id: string;
  organizations: { id: string; name: string }[];
};

export type BufferClient = {
  configured: boolean;
  getAccount(): Promise<BufferAccount>;
  listChannels(organizationId: string): Promise<BufferChannel[]>;
  listPosts(organizationId: string, opts?: { status?: BufferPostStatus[] }): Promise<BufferPost[]>;
  createPost(input: ComposeInput): Promise<BufferPost>;
  editPost(input: EditInput): Promise<BufferPost>;
  deletePost(id: string): Promise<{ ok: true }>;
  retryPost(id: string): Promise<BufferPost>;
  /** Fetch a single post's current state (status/error/sentAt) to confirm a publish. */
  getPost(id: string): Promise<BufferPost>;
};

const channelSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string().nullable().default(null),
  service: z.string(),
  avatar: z.string().default(""),
});

const channelsResponseSchema = z.object({
  channels: z.array(channelSchema),
});

const postMetricSchema = z.object({
  type: z.string(),
  name: z.string(),
  value: z.number(),
  unit: z.string(),
});

const postAssetSchema = z.object({
  type: z.enum(["image", "video", "document"]),
  source: z.string(),
  thumbnail: z.string(),
});

const postNodeSchema = z
  .object({
    id: z.string(),
    status: z.enum(["draft", "needs_approval", "scheduled", "sending", "sent", "error"]),
    text: z.string(),
    dueAt: z.string().nullable().default(null),
    sentAt: z.string().nullable().default(null),
    channelId: z.string(),
    channelService: z.string(),
    error: z.object({ message: z.string() }).nullable().default(null),
    // Buffer returns `metrics: null` for posts that have no metrics yet.
    metrics: z
      .array(postMetricSchema)
      .nullable()
      .transform((v) => v ?? [])
      .default([]),
    metricsUpdatedAt: z.string().nullable().default(null),
    assets: z.array(postAssetSchema).default([]),
  })
  .transform((p) => ({
    id: p.id,
    status: p.status,
    text: p.text,
    dueAt: p.dueAt,
    sentAt: p.sentAt,
    channelId: p.channelId,
    channelService: p.channelService,
    error: p.error?.message ?? null,
    metrics: p.metrics,
    metricsUpdatedAt: p.metricsUpdatedAt,
    imageUrl: p.assets.find((a) => a.type === "image")?.source ?? null,
    imageUrls: p.assets.filter((a) => a.type === "image").map((a) => a.source),
  }));

const postsResponseSchema = z.object({
  posts: z.object({
    edges: z.array(z.object({ node: postNodeSchema })).default([]),
  }),
});

const accountResponseSchema = z.object({
  account: z.object({
    id: z.string(),
    organizations: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
  }),
});

const getPostResponseSchema = z.object({ post: postNodeSchema });

/** Union of PostActionPayload members — discriminated by __typename. */
const postActionPayloadSchema = z.object({
  __typename: z.string(),
  message: z.string().optional(),
  post: postNodeSchema.optional(),
});

const deletePostResponseSchema = z.object({
  deletePost: z.object({
    __typename: z.string(),
    id: z.string().optional(),
    message: z.string().optional(),
  }),
});

const createPostResponseSchema = z.object({ createPost: postActionPayloadSchema });
const editPostResponseSchema = z.object({ editPost: postActionPayloadSchema });

function unwrapPostAction(result: z.infer<typeof postActionPayloadSchema>): BufferPost {
  if (result.__typename === "PostActionSuccess" && result.post) return result.post;
  throw new BufferApiError(result.message ?? `Buffer mutation failed: ${result.__typename}`);
}

const POST_FIELDS = `
  id status text dueAt sentAt channelId channelService
  error { message }
  metrics { type name value unit }
  metricsUpdatedAt
  assets { type source thumbnail }
`;

const POST_ACTION_FRAGMENT = `
  __typename
  ... on PostActionSuccess { post { ${POST_FIELDS} } }
  ... on InvalidInputError { message }
  ... on NotFoundError { message }
  ... on UnauthorizedError { message }
  ... on UnexpectedError { message }
  ... on RestProxyError { message }
  ... on LimitReachedError { message }
`;

const ACCOUNT_QUERY = `
  query Account {
    account { id organizations { id name } }
  }
`;

const CHANNELS_QUERY = `
  query Channels($input: ChannelsInput!) {
    channels(input: $input) { id name displayName service avatar }
  }
`;

const POSTS_QUERY = `
  query Posts($input: PostsInput!, $first: Int) {
    posts(input: $input, first: $first) {
      edges { node { ${POST_FIELDS} } }
    }
  }
`;

const GET_POST_QUERY = `
  query GetPost($input: PostInput!) {
    post(input: $input) { ${POST_FIELDS} }
  }
`;

const CREATE_POST_MUTATION = `
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) { ${POST_ACTION_FRAGMENT} }
  }
`;

const EDIT_POST_MUTATION = `
  mutation EditPost($input: EditPostInput!) {
    editPost(input: $input) { ${POST_ACTION_FRAGMENT} }
  }
`;

const DELETE_POST_MUTATION = `
  mutation DeletePost($input: DeletePostInput!) {
    deletePost(input: $input) {
      __typename
      ... on DeletePostSuccess { id }
      ... on VoidMutationError { message }
    }
  }
`;

/** Editing an existing post: the compose fields plus the target post id. */
export type EditInput = ComposeInput & { id: string };

function shareMode(input: ComposeInput): string {
  return input.dueAt ? "customScheduled" : input.shareNow ? "shareNow" : "addToQueue";
}

/** Build the Buffer `assets` array (video preferred over image) from compose fields. */
function buildAssets(input: ComposeInput): Record<string, unknown>[] {
  if (input.videoUrl) {
    const video: Record<string, unknown> = { url: input.videoUrl };
    if (input.thumbnailUrl) video.thumbnailUrl = input.thumbnailUrl;
    return [{ video }];
  }
  // Multiple images on an Instagram "post" render as a carousel (Instagram has no "carousel" type).
  if (input.imageUrls?.length) {
    return input.imageUrls.map((url) => ({ image: { url } }));
  }
  if (input.imageUrl) {
    const image: Record<string, unknown> = { url: input.imageUrl };
    if (input.altText) image.metadata = { altText: input.altText };
    return [{ image }];
  }
  return [];
}

function buildMetadata(input: ComposeInput): Record<string, unknown> | undefined {
  if (!input.instagramType) return undefined;
  return { instagram: { type: input.instagramType, shouldShareToFeed: true } };
}

/** Map our app-level compose form into Buffer's CreatePostInput variables. */
function toCreatePostInput(input: ComposeInput): Record<string, unknown> {
  const metadata = buildMetadata(input);
  return {
    channelId: input.channelId,
    text: input.text,
    schedulingType: "automatic",
    mode: shareMode(input),
    dueAt: input.dueAt,
    assets: buildAssets(input),
    saveToDraft: input.saveToDraft,
    ...(metadata ? { metadata } : {}),
  };
}

/** Map to EditPostInput (no channelId — editing keeps the post's channel). */
function toEditPostInput(input: EditInput): Record<string, unknown> {
  const metadata = buildMetadata(input);
  return {
    id: input.id,
    text: input.text,
    schedulingType: "automatic",
    mode: shareMode(input),
    dueAt: input.dueAt,
    assets: buildAssets(input),
    saveToDraft: input.saveToDraft,
    ...(metadata ? { metadata } : {}),
  };
}

export function createBufferClient(
  env: BufferEnv,
  fetchImpl: typeof fetch = fetch,
  sleep: SleepFn = defaultSleep,
): BufferClient {
  const token = env.BUFFER_ACCESS_TOKEN;
  const configured = Boolean(token);

  async function gql<T>(
    query: string,
    variables: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    if (!token) throw new BufferApiError("BUFFER_ACCESS_TOKEN not configured");

    let res!: Response;
    // Buffer rate-limits with HTTP 429 and can also stall the connection outright
    // when hard-throttling; an aborting timeout turns a stall into a retryable
    // failure so the hands-off daily draft never hangs.
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        res = await fetchImpl(BUFFER_GRAPHQL_ENDPOINT, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ query, variables }),
          signal: controller.signal,
        });
      } catch (e) {
        // Timeout (abort) or network error — retry with backoff, else surface it.
        if (attempt === MAX_ATTEMPTS - 1) {
          throw new BufferApiError(
            `Buffer request failed after ${MAX_ATTEMPTS} attempts: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        await sleep(BASE_BACKOFF_MS * 2 ** attempt);
        continue;
      } finally {
        clearTimeout(timer);
      }
      if (res.status !== 429 || attempt === MAX_ATTEMPTS - 1) break;
      await sleep(retryDelayMs(res, attempt));
    }

    if (res.status === 401) {
      throw new BufferApiError(
        "Buffer rejected BUFFER_ACCESS_TOKEN (401) — generate a new token at " +
          "https://publish.buffer.com/settings/api",
      );
    }
    if (!res.ok) {
      throw new BufferApiError(`Buffer API error: HTTP ${res.status}`);
    }

    const json = (await res.json()) as { data?: unknown; errors?: { message: string }[] };
    if (json.errors?.length) {
      throw new BufferApiError(json.errors.map((e) => e.message).join("; "));
    }

    const parsed = schema.safeParse(json.data);
    if (!parsed.success) {
      throw new BufferApiError(`Unexpected Buffer API response shape: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  return {
    configured,

    async getAccount() {
      const { account } = await gql(ACCOUNT_QUERY, {}, accountResponseSchema);
      return account;
    },

    async listChannels(organizationId) {
      const { channels } = await gql(
        CHANNELS_QUERY,
        { input: { organizationId } },
        channelsResponseSchema,
      );
      return channels;
    },

    async listPosts(organizationId, opts) {
      const filter = opts?.status ? { status: opts.status } : undefined;
      const { posts } = await gql(
        POSTS_QUERY,
        { input: { organizationId, ...(filter ? { filter } : {}) }, first: 50 },
        postsResponseSchema,
      );
      return posts.edges.map((e) => e.node);
    },

    async createPost(input) {
      const { createPost } = await gql(
        CREATE_POST_MUTATION,
        { input: toCreatePostInput(input) },
        createPostResponseSchema,
      );
      return unwrapPostAction(createPost);
    },

    async editPost(input) {
      const { editPost } = await gql(
        EDIT_POST_MUTATION,
        { input: toEditPostInput(input) },
        editPostResponseSchema,
      );
      return unwrapPostAction(editPost);
    },

    async deletePost(id) {
      const { deletePost } = await gql(
        DELETE_POST_MUTATION,
        { input: { id } },
        deletePostResponseSchema,
      );
      if (deletePost.__typename !== "DeletePostSuccess") {
        throw new BufferApiError(deletePost.message ?? `Buffer mutation failed: ${deletePost.__typename}`);
      }
      return { ok: true };
    },

    async getPost(id) {
      const { post } = await gql(GET_POST_QUERY, { input: { id } }, getPostResponseSchema);
      return post;
    },

    async retryPost(id) {
      const { post } = await gql(GET_POST_QUERY, { input: { id } }, getPostResponseSchema);
      const { editPost } = await gql(
        EDIT_POST_MUTATION,
        { input: { id, text: post.text, schedulingType: "automatic", mode: "shareNow" } },
        editPostResponseSchema,
      );
      return unwrapPostAction(editPost);
    },
  };
}

let cachedOrgId: string | null = null;

/** Resolve (and cache for the process lifetime) the account's first organization ID. */
export async function resolveOrgId(client: BufferClient): Promise<string> {
  if (cachedOrgId) return cachedOrgId;
  const account = await client.getAccount();
  const org = account.organizations[0];
  if (!org) throw new BufferApiError("No Buffer organization found for this account");
  cachedOrgId = org.id;
  return cachedOrgId;
}

/** Test-only: reset the module-level organization ID cache. */
export function _resetOrgIdCache(): void {
  cachedOrgId = null;
}
