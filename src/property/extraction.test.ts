import { describe, it, expect } from "vitest";
import { extractListingFields, extractJsonLd } from "./extraction";

const TR_PAGE = `<html><head>
<meta property="og:title" content=" 11 Fairway Gardens, Upper Malone Road, Belfast Property for sale at Templeton Robinson" />
</head><body>
<div class="dcell dprice"><span>Price</span><span>Offers Over</span><span>&pound;475,000</span></div>
<ul><li>4 Bedroom</li><li>2 Reception</li></ul>
<p>Stamp duty £11,250</p>
</body></html>`;

describe("extractListingFields - regex-only path (parity)", () => {
  it("pulls price, address, area and beds from an agent page", () => {
    const l = extractListingFields(
      TR_PAGE,
      "https://www.templetonrobinson.com/property/malone/trltrl67246/11-fairway-gardens/",
      "templeton-robinson",
    );
    expect(l).not.toBeNull();
    expect(l!.askingPrice).toBe(475000); // not the £11,250 stamp duty
    expect(l!.area).toBe("south-belfast"); // "malone" slug
    expect(l!.address).toBe("11 Fairway Gardens, Upper Malone Road, Belfast");
    expect(l!.beds).toBe(4);
    expect(l!.sizeSqm).toBeUndefined();
  });

  it("returns null when there is no price", () => {
    expect(
      extractListingFields("<html><body>POA</body></html>", "https://x/property/a/b/c", "x"),
    ).toBeNull();
  });

  it("skips lettings (for rent / to let)", () => {
    const rent = `<html><head>
<meta property="og:title" content="30 Shaw Street, Belmont, Belfast, BT4 1PT for rent with John Minnis" />
</head><body><div class="price-amount">&pound;895pm</div></body></html>`;
    expect(
      extractListingFields(rent, "https://x/property/belmont/id/30-shaw-street/", "jm"),
    ).toBeNull();
  });
});

const JSONLD_PAGE = `<html><head>
<meta property="og:title" content="Modern apartment in Stranmillis Property for sale at Test Agent" />
<script type="application/ld+json">
${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "SingleFamilyResidence",
  offers: { "@type": "Offer", price: "350000", priceCurrency: "GBP" },
  address: {
    "@type": "PostalAddress",
    streetAddress: "3 Test Street",
    addressLocality: "Stranmillis",
    addressRegion: "Belfast",
    postalCode: "bt9 5fn",
  },
  floorSize: { "@type": "QuantitativeValue", value: "950", unitCode: "FTK" },
  numberOfBedroomsTotal: "3",
})}
</script>
</head><body>
<div class="dcell dprice"><span>Price</span><span>Offers Over</span><span>&pound;340,000</span></div>
<ul><li>4 Bedroom</li></ul>
</body></html>`;

describe("extractListingFields - JSON-LD enrichment", () => {
  it("prefers JSON-LD price, postcode, beds, size, address and type over regex", () => {
    const l = extractListingFields(
      JSONLD_PAGE,
      "https://x/property/stranmillis/id/3-test-street/",
      "test-agent",
    );
    expect(l).not.toBeNull();
    expect(l!.askingPrice).toBe(350000); // not the £340,000 regex match
    expect(l!.postcode).toBe("BT9 5FN");
    expect(l!.beds).toBe(3); // not the "4 Bedroom" regex match
    expect(l!.sizeSqm).toBe(88); // 950 sqft -> sqm, rounded
    expect(l!.address).toBe("3 Test Street, Stranmillis, Belfast");
    expect(l!.propertyType).toBe("singlefamilyresidence"); // not the "apartment" regex match
  });

  it("falls back to regex fields when JSON-LD is present but invalid", () => {
    const html = TR_PAGE.replace(
      "</head>",
      `<script type="application/ld+json">{not valid json}</script></head>`,
    );
    const l = extractListingFields(
      html,
      "https://www.templetonrobinson.com/property/malone/trltrl67246/11-fairway-gardens/",
      "templeton-robinson",
    );
    expect(l).not.toBeNull();
    expect(l!.askingPrice).toBe(475000);
    expect(l!.beds).toBe(4);
    expect(l!.sizeSqm).toBeUndefined();
  });
});

describe("extractJsonLd", () => {
  it("finds listing data nested inside @graph", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebPage", name: "Listing page" },
        {
          "@type": "Product",
          offers: { price: "199999" },
          address: { postalCode: "BT5 6AB" },
        },
      ],
    })}</script>`;
    const fields = extractJsonLd(html);
    expect(fields?.askingPrice).toBe(199999);
    expect(fields?.postcode).toBe("BT5 6AB");
  });

  it("returns null when there is no JSON-LD script tag", () => {
    expect(extractJsonLd("<html><body>no data here</body></html>")).toBeNull();
  });

  it("returns null for a node with no price, address, postcode or size", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "WebPage",
      name: "Just a page",
    })}</script>`;
    expect(extractJsonLd(html)).toBeNull();
  });
});
