import { load } from "cheerio";

// Require an explicit timezone; a date-only label cannot supply an exact age.
const timestamp = (value: unknown): string | null => {
  if (typeof value === "number" && value > 1e9 && value < 1e14)
    return new Date(value < 1e11 ? value * 1000 : value).toISOString();
  if (
    typeof value !== "string" ||
    !/T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
  )
    return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};
export function parseEbayListingTime(
  html: string,
  itemId: string,
): string | null {
  const $ = load(html);
  const visit = (value: unknown, matchingItem = false): string | null => {
    if (!value || typeof value !== "object") return null;
    const node = value as Record<string, unknown>;
    // Never borrow dates from recommended items on the same detail page.
    const id =
      node["itemId"] ??
      node["itemID"] ??
      node["legacyItemId"] ??
      node["listingId"];
    if (id !== undefined && String(id) !== itemId) return null;
    const matches = String(id) === itemId || (id === undefined && matchingItem);
    if (matches) {
      const details = node["listingDetails"] as
        Record<string, unknown> | undefined;
      const result = timestamp(
        node["startTime"] ??
          node["itemCreationDate"] ??
          details?.["startTime"] ??
          (node["startDate"] as Record<string, unknown> | undefined)?.["value"],
      );
      if (result) return result;
    }
    for (const [key, child] of Object.entries(node)) {
      const result = visit(
        child,
        matches && /^(listingDetails|listingInfo|itemDetails)$/.test(key),
      );
      if (result) return result;
    }
    return null;
  };
  for (const script of $("script").toArray()) {
    const text = $(script).text();
    // The live View Item bootstrap embeds an escaped JSON model with a
    // listingId and startDate.value. Anchor to that item and stay inside its
    // object; countdown start times and end dates are different fields.
    const decoded = text.replace(/\\"/g, '"');
    const modelTime = new RegExp(
      `"listingId"\\s*:\\s*"${itemId}"[^{}]*"startDate"\\s*:\\s*\\{\\s*"value"\\s*:\\s*"([^"]+)"`,
    ).exec(decoded)?.[1];
    const started = timestamp(modelTime);
    if (started) return started;
    try {
      const result = visit(JSON.parse(text));
      if (result) return result;
    } catch {
      // eBay also embeds JSON as an argument in its page bootstrap script.
      for (const match of text.matchAll(
        /\{[^{}]*"(?:itemId|itemID|legacyItemId)"\s*:\s*"?\d+"?[^{}]*\}/g,
      )) {
        try {
          const result = visit(JSON.parse(match[0]));
          if (result) return result;
        } catch {}
      }
    }
  }
  return null;
}
