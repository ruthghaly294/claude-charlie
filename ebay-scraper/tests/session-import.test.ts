import { describe, it, expect } from "vitest";
import { ebayCookiesSchema } from "../src/session-import.js";
describe("eBay-only session transfer", () => {
  const cookie = {
    name: "example",
    value: "private",
    domain: ".ebay.co.uk",
    path: "/",
    expires: 1800000000,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    _crHasCrossSiteAncestor: false,
  };
  it("accepts eBay cookies and Chromium partition metadata", () => {
    expect(ebayCookiesSchema.safeParse([cookie]).success).toBe(true);
  });
  it("rejects cookies from other services and misleading domains", () => {
    for (const domain of [
      ".claude.ai",
      "ebay.co.uk.attacker.test",
      "noteBay.co.uk",
    ])
      expect(ebayCookiesSchema.safeParse([{ ...cookie, domain }]).success).toBe(
        false,
      );
  });
});
