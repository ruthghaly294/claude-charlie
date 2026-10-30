import { expect, it } from "vitest";
import { quietHours } from "../src/quiet-hours.js";

it("pauses scans from 11pm to 7am UK time in winter and summer", () => {
  const at = (iso: string) => quietHours(new Date(iso));
  expect(at("2026-10-30T22:59:00Z")).toBe(false);
  expect(at("2026-10-30T23:00:00Z")).toBe(true);
  expect(at("2026-10-31T06:59:00Z")).toBe(true);
  expect(at("2026-10-31T07:00:00Z")).toBe(false);
  expect(at("2026-07-01T22:00:00Z")).toBe(true);
  expect(at("2026-07-01T05:59:00Z")).toBe(true);
  expect(at("2026-07-01T06:00:00Z")).toBe(false);
});
