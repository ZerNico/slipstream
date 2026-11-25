import { describe, expect, it } from "vitest";
import type { ExtraTimeDefaults } from "../src/extra-time.ts";
import { ChannelId } from "../src/ids.ts";
import { draftExtraTime, newDraft } from "../src/series-editor.ts";

const skyF1 = ChannelId.make("sky-sport-f1-hd");
const arte = ChannelId.make("arte");

/** SPEC §7.7's example household: Sport 5/60, Sky Sport F1 HD 5/60, Film 2/15. */
const defaults: ExtraTimeDefaults = {
  padding: { beforeMinutes: 2, afterMinutes: 10 },
  overrides: [
    { _tag: "Category", category: "Sport", padding: { beforeMinutes: 5, afterMinutes: 60 } },
    { _tag: "Channel", channelId: skyF1, padding: { beforeMinutes: 5, afterMinutes: 60 } },
    { _tag: "Category", category: "Film", padding: { beforeMinutes: 2, afterMinutes: 15 } },
  ],
};

describe("the series recording editor's extra time", () => {
  it("starts a new F1 series from the Sky Sport F1 HD default", () => {
    const extra = draftExtraTime(defaults, newDraft({ title: "Live F1:", channel: skyF1 }));
    expect(extra.padding).toEqual({ beforeMinutes: 5, afterMinutes: 60 });
    expect(extra.overridesDefault).toBe(false);
  });

  it("lets a channel override beat a category override", () => {
    const draft = {
      ...newDraft({ channel: skyF1, categories: ["Film"] }),
      name: "x",
    };
    expect(draftExtraTime(defaults, draft).fallback.source).toEqual({
      _tag: "Channel",
      channelId: skyF1,
    });
  });

  it("uses a category default when the channel has none, comparing case-insensitively", () => {
    const extra = draftExtraTime(defaults, newDraft({ channel: arte, categories: ["film"] }));
    expect(extra.padding).toEqual({ beforeMinutes: 2, afterMinutes: 15 });
  });

  it("falls back to the global default", () => {
    const extra = draftExtraTime(defaults, newDraft({ channel: arte }));
    expect(extra.padding).toEqual({ beforeMinutes: 2, afterMinutes: 10 });
  });

  it("keeps a series recording's own values and says they differ from the default", () => {
    const draft = {
      ...newDraft({ channel: skyF1 }),
      padding: { beforeMinutes: 0, afterMinutes: 30 },
    };
    const extra = draftExtraTime(defaults, draft);
    expect(extra.padding).toEqual({ beforeMinutes: 0, afterMinutes: 30 });
    expect(extra.overridesDefault).toBe(true);
  });

  it("does not use a channel default that holds for only one of two channels", () => {
    const draft = { ...newDraft({ channel: skyF1 }), channels: [skyF1, arte] };
    expect(draftExtraTime(defaults, draft).padding).toEqual({ beforeMinutes: 2, afterMinutes: 10 });
  });
});
