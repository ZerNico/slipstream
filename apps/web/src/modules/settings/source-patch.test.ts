import { describe, expect, it } from "vitest";
import { addressField, isHttpUrl, sourceEdit, viewSource } from "@slipstream/domain";
import { makeMockData } from "~/api/mock/fixtures.ts";

const data = makeMockData(Date.UTC(2026, 10, 22, 5));
const view = (id: string) => {
  const source = data.sources.find((candidate) => candidate.id === id);
  if (source === undefined) throw new Error(`no fixture source ${id}`);
  return viewSource(source);
};

describe("addressField", () => {
  it("shows a plain address in place, and keeps one with credentials write-only", () => {
    expect(addressField({ url: "http://a.example/x.m3u", hasCredentials: false })).toEqual({
      initial: "http://a.example/x.m3u",
      writeOnly: false,
    });
    expect(addressField({ url: "http://***@a.example/x.m3u", hasCredentials: true })).toEqual({
      initial: "",
      writeOnly: true,
    });
    expect(addressField(undefined)).toEqual({ initial: "", writeOnly: false });
  });
});

describe("sourceEdit", () => {
  const form = { name: "Backup", limit: "", playlist: "", guide: "", kept: "" };

  it("leaves an untouched stored address out, so the server keeps the secret", () => {
    expect(sourceEdit(view("backup-iptv"), form)).toEqual({
      name: "Backup",
      config: { _tag: "M3u" },
    });
  });

  it("sends a newly typed address and the stream limit", () => {
    const patch = sourceEdit(view("backup-iptv"), {
      ...form,
      limit: "3",
      playlist: " http://new.example/list.m3u ",
    });
    expect(patch).toEqual({
      name: "Backup",
      maxStreams: 3,
      config: { _tag: "M3u", playlistUrl: "http://new.example/list.m3u" },
    });
  });

  it("removes a plain guide address that was emptied", () => {
    const tvproxy = view("tvproxy");
    const patch = sourceEdit(tvproxy, {
      ...form,
      name: "tvproxy",
      playlist: "http://192.168.12.11:8080/playlist.m3u",
    });
    expect(patch.config).toEqual({
      _tag: "M3u",
      playlistUrl: "http://192.168.12.11:8080/playlist.m3u",
      guideUrl: null,
    });
  });

  it("checks addresses the way the contract does", () => {
    expect(isHttpUrl("https://tv.example/epg.xml")).toBe(true);
    expect(isHttpUrl("ftp://tv.example")).toBe(false);
  });
});
