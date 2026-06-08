export type BelfastArea = "east-belfast" | "south-belfast" | "other";

/** Outward-code (BT district) → area. East/South Belfast per LPS/postal geography. */
const EAST = new Set(["BT4", "BT5", "BT6", "BT16"]);
const SOUTH = new Set(["BT7", "BT8", "BT9", "BT10"]);

/** Uppercase, collapse internal whitespace to one space: "bt5  6ab" → "BT5 6AB". */
export function normalisePostcode(pc: string): string {
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
