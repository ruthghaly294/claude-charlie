import type { Listing } from "./contract.js";
export function freshListing(
  row: Listing,
  now: number,
  maxMinutes: number,
): boolean {
  const time = row.listed_at ? Date.parse(row.listed_at) : NaN;
  return (
    Number.isFinite(time) && time <= now && now - time <= maxMinutes * 60000
  );
}
