import { describe, expect, it } from "vitest";
import { SourceId } from "../src/ids.ts";
import type { SourceView } from "../src/secrets.ts";
import { sourceDraftOf, sourceDraftProblems, sourceEdit, sourceInput } from "../src/source-form.ts";

const draft = { name: " tv ", playlist: "http://a/p.m3u", guide: "", limit: "4", kept: "2" };

const stored: SourceView = {
  id: SourceId.make("s1"),
  name: "TV",
  config: {
    _tag: "M3u",
    playlistUrl: { url: "http://***@a/p.m3u", hasCredentials: true },
    guideUrl: { url: "http://a/g.xml", hasCredentials: false },
  },
  refreshIntervalMinutes: 360,
  maxStreams: 2,
  headers: {},
  guideCleanup: { removeDuplicates: true, rewrites: [] },
  enabled: true,
  health: "ok",
  secretHeaderNames: [],
};

describe("source form", () => {
  it("builds a source from the form and checks its addresses", () => {
    expect(sourceInput(draft)).toMatchObject({
      name: "tv",
      maxStreams: 4,
      keptForRecordings: 2,
      config: { _tag: "M3u", playlistUrl: "http://a/p.m3u" },
    });
    expect(
      sourceDraftProblems({ ...draft, playlist: "nope", name: "" }, { playlist: false }),
    ).toEqual({ name: "nameMissing", playlist: "urlInvalid" });
    expect(sourceDraftProblems({ ...draft, playlist: "" }, { playlist: true })).toEqual({});
  });

  it("opens a stored source with write-only addresses empty", () => {
    expect(sourceDraftOf(stored)).toEqual({
      name: "TV",
      playlist: "",
      guide: "http://a/g.xml",
      limit: "2",
      kept: "",
      autoAddNew: false,
    });
    expect(sourceDraftOf(undefined).name).toBe("");
  });

  it("sends adding new streams automatically only when it is on or changed", () => {
    expect(sourceInput(draft)).not.toHaveProperty("autoAddNew");
    expect(sourceInput({ ...draft, autoAddNew: true })).toMatchObject({ autoAddNew: true });
    expect(sourceEdit(stored, sourceDraftOf(stored))).not.toHaveProperty("autoAddNew");
    expect(sourceEdit(stored, { ...sourceDraftOf(stored), autoAddNew: true })).toMatchObject({
      autoAddNew: true,
    });
    expect(
      sourceEdit({ ...stored, autoAddNew: true }, { ...sourceDraftOf(stored), autoAddNew: false }),
    ).toMatchObject({ autoAddNew: false });
  });

  it("keeps the stored playlist and removes an emptied guide on edit", () => {
    expect(sourceEdit(stored, { ...sourceDraftOf(stored), guide: "", kept: "1" })).toEqual({
      name: "TV",
      maxStreams: 2,
      keptForRecordings: 1,
      config: { _tag: "M3u", guideUrl: null },
    });
  });
});
