import { describe, expect, it } from "vitest";
import { bigGroups, bigGuideChannels, bigLineup, renderBigPlaylist } from "./big-lineup.ts";
import { channels } from "./channels.ts";
import { renderXmltv } from "./render.ts";

const baseUrl = "http://fake.test:8090";

describe("big line-up", () => {
  it("has about 4,800 streams in 28 groups, the same every time", () => {
    expect(bigLineup.length).toBeGreaterThan(4500);
    expect(bigLineup.length).toBeLessThanOrEqual(5000);
    expect(bigGroups).toHaveLength(28);
    expect(new Set(bigLineup.map((entry) => entry.group))).toEqual(new Set(bigGroups));
    expect(bigLineup.slice(0, 2).map((entry) => entry.name)).toEqual(["Das Erste HD", "Das Erste"]);
  });

  it("has HD, SD and FHD copies sharing a guide id, and partial guide coverage", () => {
    const names = new Set(bigLineup.map((entry) => entry.name));
    expect(names.has("Eurosport 1 HD")).toBe(true);
    expect(bigLineup.some((entry) => entry.name.endsWith(" FHD"))).toBe(true);
    const copies = bigLineup.filter((entry) => entry.name.startsWith("Das Erste"));
    expect(new Set(copies.map((entry) => entry.tvgId)).size).toBe(1);
    const covered = bigLineup.filter((entry) => entry.inGuide).length / bigLineup.length;
    expect(covered).toBeGreaterThan(0.2);
    expect(covered).toBeLessThan(0.8);
    expect(bigLineup.filter((entry) => entry.group === "Radio").every((e) => !e.inGuide)).toBe(
      true,
    );
  });

  it("carries the normal channels under their own guide ids", () => {
    for (const channel of channels) {
      expect(bigLineup.some((entry) => entry.tvgId === channel.tvgId)).toBe(true);
    }
  });

  it("renders a playlist that plays the test streams and a guide of the covered ids", () => {
    const lines = renderBigPlaylist({ baseUrl }).trimEnd().split("\n");
    expect(lines[0]).toContain(`url-tvg="${baseUrl}/epg.xml?lineup=big"`);
    expect(lines).toHaveLength(1 + bigLineup.length * 2);
    expect(lines[1]).toBe(
      '#EXTINF:-1 tvg-id="daserste.de.big" tvg-name="Das Erste HD" group-title="DE | Vollprogramm",Das Erste HD',
    );
    expect(
      lines.filter((line) => line.startsWith("http")).every((line) => line.includes("/stream/")),
    ).toBe(true);

    const extra = bigGuideChannels();
    const guide = renderXmltv({
      baseUrl,
      channels,
      programmes: [],
      timeZone: "Europe/Berlin",
      extraChannels: extra,
    });
    expect(guide.match(/<channel id=/g)).toHaveLength(channels.length + extra.length);
    expect(guide).toContain('<channel id="daserste.de.big">');
  });
});
