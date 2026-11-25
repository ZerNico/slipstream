import { describe, expect, it } from "vitest";
import { playerKeyFor } from "./player-keys.ts";
import { qualityRequest } from "@slipstream/domain";
import { defaultPrefs, prefKeys, readPrefs } from "./player-prefs.ts";
import { endsAt, surroundAsStereo } from "./speed.ts";

const key = (k: string, extra: Partial<KeyboardEvent> = {}) =>
  playerKeyFor({
    key: k,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...extra,
  });

describe("speed", () => {
  it("ends a finished recording sooner at a higher speed", () => {
    expect(endsAt({ now: 0, leftMs: 600_000, speed: 2 })).toBe(300_000);
  });

  it("plays surround as stereo only off 1×", () => {
    expect(surroundAsStereo(1.25, 6)).toBe(true);
    expect(surroundAsStereo(1, 6)).toBe(false);
    expect(surroundAsStereo(1.25, 2)).toBe(false);
    expect(surroundAsStereo(1.25, undefined)).toBe(false);
  });
});

describe("player keys", () => {
  it("maps the SPEC §7.2 keys", () => {
    expect(key(" ")).toEqual({ kind: "toggle" });
    expect(key("k")).toEqual({ kind: "toggle" });
    expect(key("ArrowLeft")).toEqual({ kind: "seek", seconds: -10 });
    expect(key("ArrowRight", { shiftKey: true })).toEqual({ kind: "seek", seconds: 60 });
    expect(key("j")).toEqual({ kind: "seek", seconds: -10 });
    expect(key("Home")).toEqual({ kind: "start" });
    expect(key("End")).toEqual({ kind: "live" });
    expect(key("ArrowUp")).toEqual({ kind: "volume", delta: 5 });
    expect(key("m")).toEqual({ kind: "mute" });
    expect(key("r")).toEqual({ kind: "record" });
    expect(key("R")).toEqual({ kind: "record" });
    expect(key("r", { metaKey: true })).toBeUndefined();
    expect(key(">")).toEqual({ kind: "speed", direction: 1 });
    expect(key("<")).toEqual({ kind: "speed", direction: -1 });
    expect(key("a")).toEqual({ kind: "menu", menu: "audio" });
    expect(key("q")).toEqual({ kind: "menu", menu: "quality" });
    expect(key("i")).toEqual({ kind: "panel" });
    expect(key("z")).toEqual({ kind: "fit" });
    expect(key("f")).toEqual({ kind: "fullscreen" });
    expect(key("Escape")).toEqual({ kind: "close" });
  });

  it("leaves the palette, the shortcuts list and browser keys alone", () => {
    expect(key("k", { metaKey: true })).toBeUndefined();
    expect(key("?")).toBeUndefined();
    expect(key("/")).toBeUndefined();
    expect(key("g")).toBeUndefined();
  });
});

const storage = (values: Record<string, string>) => ({
  getItem: (k: string) => values[k] ?? null,
  setItem: () => {},
});

describe("player preferences", () => {
  it("start from the defaults on a fresh or blocked device", () => {
    expect(readPrefs(undefined)).toEqual(defaultPrefs);
    expect(
      readPrefs({
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {},
      }),
    ).toEqual(defaultPrefs);
  });

  it("read each key on its own and skip broken values", () => {
    expect(
      readPrefs(
        storage({
          [prefKeys.fit]: "fit",
          [prefKeys.volume]: "140",
          [prefKeys.muted]: "true",
          [prefKeys.quality]: "nonsense",
          [prefKeys.stats]: "true",
        }),
      ),
    ).toEqual({ fit: "fit", volume: 100, muted: true, quality: "auto", stats: true });
  });

  it("turn a quality choice into what the server is asked for", () => {
    expect(qualityRequest("auto")).toEqual({ _tag: "Auto" });
    expect(qualityRequest("original")).toEqual({ _tag: "Original" });
    expect(qualityRequest("4000")).toEqual({ _tag: "Bitrate", kbps: 4000 });
  });
});
