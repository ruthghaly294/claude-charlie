import { readFile, unlink } from "node:fs/promises";
import type { BrowserContext } from "playwright-core";
import { z } from "zod";
import { markets } from "./query.js";
export const ebayCookiesSchema = z
  .array(
    z.strictObject({
      name: z.string().min(1),
      value: z.string(),
      domain: z
        .string()
        .refine((domain) =>
          Object.keys(markets).some(
            (m) =>
              domain.replace(/^\./, "") === `ebay.${m}` ||
              domain.endsWith(`.ebay.${m}`),
          ),
        ),
      path: z.string().startsWith("/"),
      expires: z.number(),
      httpOnly: z.boolean(),
      secure: z.boolean(),
      sameSite: z.enum(["Strict", "Lax", "None"]),
      _crHasCrossSiteAncestor: z.boolean().optional(),
      partitionKey: z.string().optional(),
    }),
  )
  .max(500);
export async function importEbaySession(
  context: BrowserContext,
  path: string,
): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return;
    throw error;
  }
  const cookies = ebayCookiesSchema.parse(JSON.parse(raw));
  await context.addCookies(
    cookies.map(({ partitionKey, _crHasCrossSiteAncestor, ...cookie }) => ({
      ...cookie,
      ...(partitionKey !== undefined ? { partitionKey } : {}),
    })),
  );
  await unlink(path);
}
