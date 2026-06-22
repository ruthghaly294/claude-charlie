import type { Connector } from "../types";
import { rssConnector } from "./rss";
import { githubConnector } from "./github";
import { redditConnector } from "./reddit";
import { hackernewsConnector } from "./hackernews";
import { youtubeConnector } from "./youtube";
import { googleCseConnector } from "./googleCse";
import { twitterConnector } from "./twitter";
import { productHuntConnector } from "./productHunt";
import { tiktokSoundsConnector } from "./tiktokSounds";
import { createLast30DaysConnector } from "./last30days";

/** Ordered registry of all discovery connectors. */
export const CONNECTORS: Connector[] = [
  rssConnector,
  githubConnector,
  redditConnector,
  hackernewsConnector,
  youtubeConnector,
  googleCseConnector,
  twitterConnector,
  productHuntConnector,
  tiktokSoundsConnector,
  createLast30DaysConnector(),
];

export function getConnector(key: string): Connector | undefined {
  return CONNECTORS.find((c) => c.key === key);
}

export {
  rssConnector,
  githubConnector,
  redditConnector,
  hackernewsConnector,
  youtubeConnector,
  googleCseConnector,
  twitterConnector,
  productHuntConnector,
  tiktokSoundsConnector,
  createLast30DaysConnector,
};
