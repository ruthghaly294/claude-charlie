export class ScrapeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 502,
  ) {
    super(message);
    this.name = "ScrapeError";
  }
}

export function ebaySignInRequired(): ScrapeError {
  return new ScrapeError(
    "UPSTREAM_AUTH_REQUIRED",
    "eBay requires sign-in for completed listings. Sign into the server Chrome profile with npm run login, or connect a dedicated signed-in Chrome using EBAY_CHROME_CDP.",
    503,
  );
}
