export type BelfastArea = "east-belfast" | "south-belfast" | "other";

/** Outward-code (BT district) → area. East/South Belfast per LPS/postal geography. */
const EAST = new Set(["BT4", "BT5", "BT6", "BT16"]);
const SOUTH = new Set(["BT7", "BT8", "BT9", "BT10"]);

/** Uppercase, one internal space (inserted if missing): "bt57dl" → "BT5 7DL". */
export function normalisePostcode(pc: string): string {
  const compact = pc.toUpperCase().replace(/\s+/g, "");
  const m = compact.match(/^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/);
  if (m) return `${m[1]} ${m[2]}`;
  return pc.toUpperCase().replace(/\s+/g, " ").trim();
}

/** The outward code (district): "BT5 6AB" → "BT5". */
export function outwardCode(pc: string): string {
  const m = normalisePostcode(pc).match(/^([A-Z]{1,2}\d{1,2})/);
  return m ? m[1]! : "";
}

/** Classify a postcode into the tracked Belfast areas. */
export function classifyArea(pc: string): BelfastArea {
  const out = outwardCode(pc);
  if (EAST.has(out)) return "east-belfast";
  if (SOUTH.has(out)) return "south-belfast";
  return "other";
}

/** True if the postcode is in one of the areas we track. */
export function isTrackedArea(pc: string): boolean {
  return classifyArea(pc) !== "other";
}

/** Belfast neighbourhood slugs estate agents use in listing URLs → area. */
const EAST_SLUGS = [
  "east-belfast", "stormont", "belmont", "knock", "ballyhackamore",
  "strandtown", "sydenham", "gilnahirk", "dundonald", "cherryvalley",
  "kings-road", "castlereagh", "cregagh", "gilnahirk", "comber-road",
];
const SOUTH_SLUGS = [
  "south-belfast", "malone", "upper-malone", "lisburn-road", "lisburn-road-area",
  "stranmillis", "ormeau", "finaghy", "balmoral", "rosetta", "four-winds",
  "galwally", "annadale", "belvoir", "newforge",
];

/**
 * Classify an estate-agent URL/slug into a tracked area when there's no
 * postcode (agent pages often omit it). Matches explicit area tokens first,
 * then known East/South Belfast neighbourhood names.
 */
export function areaFromSlug(text: string): BelfastArea {
  const t = text.toLowerCase();
  if (EAST_SLUGS.some((s) => t.includes(s))) return "east-belfast";
  if (SOUTH_SLUGS.some((s) => t.includes(s))) return "south-belfast";
  return "other";
}
