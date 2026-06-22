import { describe, it, expect } from "vitest";
import { mapToSafeTrack } from "./royaltyFreeMap";
import type { SoundTrend } from "./musicTrends";

const trend = (over: Partial<SoundTrend> = {}): SoundTrend => ({
  topic: "productivity",
  title: "Some commercial banger",
  url: "https://tiktok.com/sound/1",
  whereTrending: "tiktok",
  engagement: 1000,
  mood: "hype",
  energy: "high",
  ...over,
});

describe("mapToSafeTrack", () => {
  it("maps a trend to a royalty-free search query that preserves mood and energy", () => {
    const safe = mapToSafeTrack(trend());
    expect(safe.mood).toBe("hype");
    expect(safe.energy).toBe("high");
    expect(safe.searchQuery).toMatch(/hype/i);
    expect(safe.licence).toBe("royalty-free");
  });

  it("never marks the original commercial trend as embeddable, and carries no track url by default", () => {
    const safe = mapToSafeTrack(trend());
    expect(safe.trackUrl).toBeNull();
    expect(safe.embeddable).toBe(false);
    expect(safe.note).toMatch(/in-app|royalty-free/i);
  });

  it("uses a supplied royalty-free library track for the mood and marks it embeddable", () => {
    const safe = mapToSafeTrack(trend({ mood: "chill" }), {
      library: { chill: "https://cdn.example/cc0/chill-1.mp3" },
    });
    expect(safe.trackUrl).toBe("https://cdn.example/cc0/chill-1.mp3");
    expect(safe.embeddable).toBe(true);
  });

  it("falls back to a generic provider for an unknown mood", () => {
    const safe = mapToSafeTrack(trend({ mood: "neutral", energy: "medium" }));
    expect(safe.provider).toBeTruthy();
    expect(safe.searchQuery).toMatch(/medium|neutral/i);
  });
});
