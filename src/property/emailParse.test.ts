import { describe, it, expect } from "vitest";
import { parsePropertyPalEmail } from "./emailParse";

const EMAIL = `
<html><body>
<h1>New listings matching East Belfast</h1>
<table>
  <tr><td>
    <a href="https://www.propertypal.com/12-cregagh-road-belfast/845001">12 Cregagh Road, Belfast, BT6 9AA</a>
    <p>Offers over £189,950</p>
    <p>3 bedroom semi-detached house · 92 sq. m</p>
  </td></tr>
  <tr><td>
    <a href="https://email.propertypal.com/c/redir?u=https%3A%2F%2Fwww.propertypal.com%2Fhouse-bt9%2F845002">8 Malone Avenue, BT9 6ER</a>
    <p>£325,000</p>
    <p>4 bed terrace</p>
  </td></tr>
  <tr><td>
    <a href="https://www.propertypal.com/unsubscribe">Unsubscribe</a>
  </td></tr>
  <tr><td>
    <a href="https://www.propertypal.com/no-price-listing/845003">Coming soon house</a>
    <p>Price on application</p>
  </td></tr>
</table>
</body></html>`;

describe("parsePropertyPalEmail", () => {
  it("extracts priced listings with address, postcode, beds and size", () => {
    const out = parsePropertyPalEmail(EMAIL);
    expect(out).toHaveLength(2); // unsubscribe + no-price skipped

    const first = out[0]!;
    expect(first.askingPrice).toBe(189950);
    expect(first.postcode).toBe("BT6 9AA");
    expect(first.beds).toBe(3);
    expect(first.sizeSqm).toBe(92);
    expect(first.url).toBe("https://www.propertypal.com/12-cregagh-road-belfast/845001");
  });

  it("unwraps tracking-redirect links to the real PropertyPal url", () => {
    const out = parsePropertyPalEmail(EMAIL);
    expect(out[1]!.url).toBe("https://www.propertypal.com/house-bt9/845002");
    expect(out[1]!.postcode).toBe("BT9 6ER");
  });

  it("skips unsubscribe links and price-on-application listings", () => {
    const urls = parsePropertyPalEmail(EMAIL).map((l) => l.url);
    expect(urls.some((u) => u?.includes("unsubscribe"))).toBe(false);
    expect(urls.some((u) => u?.includes("no-price-listing"))).toBe(false);
  });
});
