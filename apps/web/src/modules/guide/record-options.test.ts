import { DateTime } from "effect";
import { describe, expect, it } from "vitest";
import { ChannelId, MINUTE, type Programme, ProgrammeId } from "@slipstream/domain";
import { pathLabels } from "@slipstream/i18n";
import { extraTimeHint, offerPreview } from "./record-options.ts";

const start = Date.UTC(2026, 10, 22, 17, 0);
const skyF1 = ChannelId.make("sky-sport-f1");

const programme = (title: string, extra: Partial<Programme> = {}): Programme => ({
  id: ProgrammeId.make(`p-${title}`),
  channelId: skyF1,
  start: DateTime.makeUnsafe(start),
  end: DateTime.makeUnsafe(start + 90 * MINUTE),
  title,
  categories: ["Sport"],
  repeat: false,
  live: true,
  ...extra,
});

describe("extraTimeHint", () => {
  const effective = {
    padding: { beforeMinutes: 1, afterMinutes: 30 },
    source: { _tag: "Category" as const, category: "Sport" },
  };

  it("gives the steppers the server's effective default", () => {
    expect(extraTimeHint(effective, undefined)).toEqual({
      padding: effective.padding,
      fallback: effective,
      overridesDefault: false,
    });
  });

  it("says when the reader stepped away from the default", () => {
    const hint = extraTimeHint(effective, { beforeMinutes: 5, afterMinutes: 50 });
    expect(hint.padding.afterMinutes).toBe(50);
    expect(hint.fallback.padding.afterMinutes).toBe(30);
    expect(hint.overridesDefault).toBe(true);
    expect(extraTimeHint(effective, effective.padding).overridesDefault).toBe(false);
  });
});

describe("the collection offer's preview", () => {
  it("shows where a session would sit with the offer's layout, under the typed name", () => {
    const preview = offerPreview(
      "Live F1",
      {
        parts: [
          { _tag: "Split", name: "event", after: { separator: " - ", occurrence: "last" } },
          { _tag: "Split", name: "programme", before: { separator: " - ", occurrence: "last" } },
        ],
        path: ["{year}", "{event}", "{programme}"],
      },
      programme("Live F1: Rennen - GP Katar"),
      pathLabels(),
      { timeZone: "Europe/Berlin" },
    );
    expect(preview).toBe("Live F1 › 2026 › GP Katar › Rennen");
  });

  it("follows the name as it is typed", () => {
    const layout = { parts: [], path: ["{year}"] };
    const p = programme("Live F1: Rennen - GP Katar");
    const context = { timeZone: "Europe/Berlin" };
    expect(offerPreview("Formel Eins", layout, p, pathLabels(), context)).toMatch(
      /^Formel Eins › /u,
    );
  });

  it("never repeats the collection name under Other", () => {
    const layout = {
      parts: [{ _tag: "Split" as const, name: "programme" }],
      path: ["{programme}"],
    };
    const news = programme("Nachrichten", { categories: ["News"] });
    expect(offerPreview("Nachrichten", layout, news, pathLabels(), { timeZone: "UTC" })).toBe(
      "Nachrichten › Other",
    );
  });
});
