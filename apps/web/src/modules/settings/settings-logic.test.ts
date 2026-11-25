import { describe, expect, it } from "vitest";
import { earlyChoices, lateChoices } from "~/ui/minutes.ts";
import { isHouseholdSection, settingsGroups, visibleSections } from "./sections.ts";
import { sourceInput } from "@slipstream/domain";
import { sourceErrors } from "./source-text.ts";

// The form's edits (add, remove, change an exception) live in the domain and are tested there.
describe("recording defaults form", () => {
  it("offers the usual minutes and keeps a value set elsewhere in order", () => {
    expect(earlyChoices(2)).toContain(2);
    expect(earlyChoices(7)).toEqual([0, 1, 2, 3, 5, 7, 10, 15, 20, 30, 45, 60]);
    expect(lateChoices(240).at(-1)).toBe(240);
  });
});

describe("sections and sources", () => {
  it("groups This device, Your profile and, for the admin only, the household", () => {
    expect(settingsGroups("admin").map((group) => group.kind)).toEqual([
      "device",
      "profile",
      "household",
    ]);
    expect(visibleSections("admin")).toEqual([
      "device",
      "profile",
      "sources",
      "recording",
      "users",
      "playback",
      "storage",
    ]);
    expect(visibleSections("user")).toEqual(["device", "profile"]);
    expect(visibleSections("admin").filter(isHouseholdSection)).toHaveLength(5);
  });

  it("builds a source from the form and checks its addresses", () => {
    const draft = { name: " tv ", playlist: "http://a/p.m3u", guide: "", limit: "4", kept: "2" };
    expect(sourceInput(draft)).toMatchObject({
      name: "tv",
      maxStreams: 4,
      keptForRecordings: 2,
      config: { _tag: "M3u", playlistUrl: "http://a/p.m3u" },
    });
    expect(Object.keys(sourceErrors({ ...draft, playlist: "nope" }, { playlist: false }))).toEqual([
      "playlist",
    ]);
    expect(sourceErrors({ ...draft, playlist: "" }, { playlist: true })).toEqual({});
  });
});
