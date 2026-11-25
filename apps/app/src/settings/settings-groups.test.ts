import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@slipstream/i18n";
import { householdDefaultLine, rowKeys, settingsRows } from "./settings-groups.ts";

afterEach(() => setLocale("en"));

describe("settingsRows", () => {
  it("gives an admin's phone all three groups, This device first", () => {
    const rows = settingsRows({ admin: true, tv: false, shared: true });
    expect(rows.device).toEqual(["language", "quality", "fit", "link", "server"]);
    expect(rows.profile).toEqual(["profile", "switch", "add", "signOut"]);
    expect(rows.household).toEqual(["sources", "recording", "users", "playback", "storage"]);
    expect(rowKeys(rows)[0]).toBe("language");
  });

  it("hides the household from everyone else, and Link TV and Switch profile where they make no sense", () => {
    const rows = settingsRows({ admin: false, tv: true, shared: false });
    expect(rows.device).toEqual(["language", "quality", "fit", "server"]);
    expect(rows.profile).toEqual(["profile", "add", "signOut"]);
    expect(rows.household).toEqual([]);
    expect(rowKeys(rows)).toHaveLength(7);
  });
});

describe("householdDefaultLine", () => {
  const household = { home: "original", away: "auto", mobile: "2000" } as const;

  it("says what the household default is on this connection", () => {
    expect(householdDefaultLine(household, "mobile")).toMatch(/^Now Data saver · 2/u);
    expect(householdDefaultLine(household, "lan")).toBe("At home Original, away Automatic");
  });

  it("explains the choice while the household's answer is out, or when it is Automatic", () => {
    expect(householdDefaultLine(undefined, "lan")).toBe(
      "Follows the server’s default quality for this connection",
    );
    expect(householdDefaultLine(household, "remote")).toBe(
      "Follows the server’s default quality for this connection",
    );
  });
});
