import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@slipstream/i18n";
import { ChannelId } from "@slipstream/domain";
import { makeMockData } from "~/api/mock/fixtures.ts";
import { cardSummary } from "./summary.ts";

const data = makeMockData(Date.UTC(2026, 10, 22, 5));
const f1 = data.rules[0]!;
const tatort = data.rules[1]!;
const channelName = (id: ChannelId) => data.channels.find((channel) => channel.id === id)?.name;

afterEach(() => setLocale("en"));

describe("rule sentences", () => {
  it("names a card's channels and days", () => {
    expect(cardSummary(f1, channelName)).toBe("Sky Sport F1");
    expect(cardSummary(tatort, channelName)).toBe("Das Erste · Sun");
    setLocale("de");
    expect(cardSummary(tatort, channelName)).toBe("Das Erste · So");
  });
});
