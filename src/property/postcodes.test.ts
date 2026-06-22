import { describe, it, expect } from "vitest";
import {
  normalisePostcode,
  outwardCode,
  classifyArea,
  isTrackedArea,
} from "./postcodes";

describe("normalisePostcode", () => {
  it("uppercases and collapses whitespace", () => {
    expect(normalisePostcode("bt5  6ab")).toBe("BT5 6AB");
    expect(normalisePostcode(" Bt9 7Aa ")).toBe("BT9 7AA");
  });
});

describe("outwardCode", () => {
  it("extracts the BT district", () => {
    expect(outwardCode("BT5 6AB")).toBe("BT5");
    expect(outwardCode("bt16 1xy")).toBe("BT16");
    expect(outwardCode("nonsense")).toBe("");
  });
});

describe("classifyArea", () => {
  it("maps East and South Belfast districts", () => {
    expect(classifyArea("BT5 6AB")).toBe("east-belfast");
    expect(classifyArea("BT4 1AA")).toBe("east-belfast");
    expect(classifyArea("BT9 7AA")).toBe("south-belfast");
    expect(classifyArea("BT7 1AA")).toBe("south-belfast");
    expect(classifyArea("BT1 1AA")).toBe("other");
    expect(classifyArea("BT15 1AA")).toBe("other"); // north
  });
});

describe("isTrackedArea", () => {
  it("is true only for east/south Belfast", () => {
    expect(isTrackedArea("BT6 9AA")).toBe(true);
    expect(isTrackedArea("BT8 7AA")).toBe(true);
    expect(isTrackedArea("BT48 1AA")).toBe(false);
  });
});
