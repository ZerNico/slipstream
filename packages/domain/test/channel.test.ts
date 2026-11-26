import { describe, expect, it } from "vitest";
import { DateTime } from "effect";
import { ChannelId } from "../src/ids.ts";
import {
  channelMark,
  displayChannelName,
  guideChannelOrder,
  onAirNow,
  visibleChannels,
} from "../src/channel.ts";

describe("displayChannelName", () => {
  it("drops a trailing quality tag, whatever its case", () => {
    expect(displayChannelName("Das Erste HD")).toBe("Das Erste");
    expect(displayChannelName("Sky Sport F1 uhd")).toBe("Sky Sport F1");
    expect(displayChannelName("ZDF")).toBe("ZDF");
  });
});

describe("channelMark", () => {
  it("keeps a one-word name of up to five characters whole", () => {
    expect(channelMark("ZDF")).toBe("ZDF");
    expect(channelMark("arte")).toBe("arte");
    expect(channelMark("3sat")).toBe("3sat");
    expect(channelMark("")).toBe("");
  });

  it("never cuts a long word into a stub", () => {
    expect(channelMark("Kunterbunt")).toBe("K");
    expect(channelMark("Serienwelt HD")).toBe("S");
    expect(channelMark("ProSieben")).toBe("PS");
    expect(channelMark("Kino Klassik")).toBe("KK");
    expect(channelMark("Regional Fernsehen")).toBe("RF");
  });

  it("uses a last word that says something and fits, without a quality tag", () => {
    expect(channelMark("Das Erste")).toBe("Erste");
    expect(channelMark("Sky Sport F1 HD")).toBe("F1");
    expect(channelMark("Sportkanal F1 HD")).toBe("F1");
    expect(channelMark("Doku Plus SD")).toBe("Plus");
    expect(channelMark("Testbild Kurz")).toBe("Kurz");
  });

  it("falls back to the initials with any number, whole pieces only", () => {
    expect(channelMark("Nachrichten 24")).toBe("N24");
    expect(channelMark("Sky Sport 1")).toBe("SS1");
    expect(channelMark("Sky Cinema Premiere Action 2026")).toBe("SCPA");
  });

  it("only ever returns whole words or initials, at most five characters", () => {
    const names = ["Kunterbunt", "Kino Klassik", "Serienwelt HD", "Eurosport 1 HD", "Das Erste"];
    for (const name of names) {
      const mark = channelMark(name);
      expect(mark.length).toBeLessThanOrEqual(5);
      const words = name.split(" ");
      const whole = words.includes(mark);
      const initialsOnly = mark
        .split("")
        .every((char) => words.some((word) => word.startsWith(char) || /\d/u.test(char)));
      expect(whole || initialsOnly).toBe(true);
    }
  });
});

describe("visibleChannels", () => {
  it("drops hidden channels and sorts the rest in guide order", () => {
    const channels = [
      { name: "ZDF", number: 2, hidden: false },
      { name: "Shop", number: 1, hidden: true },
      { name: "arte", hidden: false },
      { name: "Das Erste", number: 1, hidden: false },
    ];
    expect(visibleChannels(channels).map((channel) => channel.name)).toEqual([
      "Das Erste",
      "ZDF",
      "arte",
    ]);
  });
});

describe("guideChannelOrder", () => {
  it("sorts by number, unnumbered channels last, then by name", () => {
    const channels = [
      { name: "arte" },
      { name: "ZDF", number: 2 },
      { name: "Das Erste", number: 1 },
      { name: "3sat" },
      { name: "Phoenix", number: 2 },
    ];
    expect(channels.toSorted(guideChannelOrder).map((channel) => channel.name)).toEqual([
      "Das Erste",
      "Phoenix",
      "ZDF",
      "3sat",
      "arte",
    ]);
  });
});

const at = (millis: number) => DateTime.makeUnsafe(millis);
const channel = (id: string, name: string, number: number, hidden = false) => ({
  id: ChannelId.make(id),
  name,
  number,
  hidden,
});

const show = (id: string, from: number, to: number) => ({ id, start: at(from), end: at(to) });

describe("onAirNow", () => {
  const T = Date.UTC(2026, 10, 26, 20);
  const HOUR = 3_600_000;
  const f1 = channel("f1", "Sky Sport F1", 106);
  const ard = channel("ard", "Das Erste", 1);
  const old = channel("old", "Old", 50, true);

  it("lists what airs now on each visible channel, in channel order", () => {
    const items = onAirNow(
      [f1, ard, old],
      [
        { channelId: f1.id, now: show("race", T - HOUR, T + HOUR) },
        { channelId: ard.id, now: show("news", T - HOUR / 4, T + HOUR / 4) },
        { channelId: old.id, now: show("later", T - HOUR, T + HOUR) },
      ],
      T,
    );
    expect(items.map((item) => [item.channel.id, item.programme.id])).toEqual([
      ["ard", "news"],
      ["f1", "race"],
    ]);
  });

  it("leaves out channels with nothing on air at that moment", () => {
    const race = show("race", T - HOUR, T + HOUR);
    expect(
      onAirNow([f1, ard], [{ channelId: f1.id, now: race }, { channelId: ard.id }], T + 2 * HOUR),
    ).toEqual([]);
    expect(onAirNow([f1], [{ channelId: f1.id, now: race }], T + HOUR)).toEqual([]);
    expect(onAirNow([f1], [], T)).toEqual([]);
  });
});
