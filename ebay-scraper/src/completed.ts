import type { Money } from "./contract.js";

export function completionDetails(
  text: string,
  price: Money | null,
  struckPrice: boolean,
) {
  const match = text.match(
    /(?:^|\s)(Sold|Ended)\s+(?:on\s+)?(\d{1,2}\s+[A-Za-z]{3,9}(?:\s+\d{4})?|[A-Za-z]{3,9}\s+\d{1,2}(?:,?\s+\d{4})?)/i,
  );
  if (!match?.[1] || !match[2]) return null;
  const isSold = /\b(?:not sold|unsold|did not sell)\b/i.test(text)
    ? false
    : /^sold$/i.test(match[1])
      ? true
      : null;
  const accepted = /\b(?:best\s+)?offer accepted\b/i.test(text);
  return {
    is_sold: isSold,
    ended_date: match[2],
    sold_date: isSold ? match[2] : null,
    sale_price: isSold && !accepted && !struckPrice ? price : null,
    best_offer_accepted: accepted,
  };
}
