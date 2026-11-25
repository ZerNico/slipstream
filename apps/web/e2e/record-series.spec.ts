import { expect, test, type Page } from "@playwright/test";
import { afterPaint, recordLayoutShifts, takeLayoutShifts } from "./support/layout.ts";
import { api, requireServer, seed, settle } from "./support/session.ts";
import { revealCell } from "./support/guide.ts";

/*
 * Series recordings from the programme sheet against a real server and the fake source
 * (recording model §3.1, §3.3, §3.6): Record every with Undo, the collection offer without a
 * layout shift, and a later airing's Repeat state with Record anyway and the guide's check.
 */

requireServer({ source: true });

interface Programme {
  readonly id: string;
  readonly title: string;
  readonly channelId: string;
  readonly start: string;
  readonly end: string;
  readonly episode?: { readonly season?: number; readonly episode?: number };
}

interface Entry {
  readonly id: string;
  readonly programmeId?: string;
  readonly ruleId?: string;
  readonly title: string;
}

interface Rule {
  readonly id: string;
  readonly name: string;
}

interface Named {
  readonly id: string;
  readonly name: string;
}

/** The count in "6 will record". */
const counted = (text: string | null) => /(\d+) will record/u.exec(text ?? "")?.[1];

/** One episode of a show, whatever channel or time it airs. */
const episodeOf = (p: Programme) => `${p.title}|${p.episode?.season}|${p.episode?.episode}`;

/** The guide from now on, `hours` ahead. */
const guide = (page: Page, hours: number) => {
  const from = new Date(Date.now()).toISOString();
  const to = new Date(Date.now() + hours * 3_600_000).toISOString();
  return api(page).get<Programme[]>(`/api/guide?from=${from}&to=${to}`);
};

/** A channel of the fake source by name. */
const channel = async (page: Page, name: string): Promise<Named> => {
  const found = (await api(page).get<Named[]>("/api/channels")).find((c) => c.name === name);
  if (found === undefined) throw new Error(`no channel ${name}`);
  return found;
};

/** The household day a moment falls on, as the guide's `day` param names it (YYYY-MM-DD). */
const dayParam = async (page: Page, at: string): Promise<string> => {
  const { timeZone } = await api(page).get<{ timeZone: string }>("/api/system");
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(at));
};

/**
 * Opens a programme's sheet from the timeline grid by keyboard: the guide on its day, focus on
 * its cell, Enter.
 */
const openByKeyboard = async (page: Page, programme: Programme) => {
  await page.goto(`/guide?day=${await dayParam(page, programme.start)}`);
  await settle(page);
  const target = await revealCell(page, programme.id, programme.start);
  await target.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL((url) => url.searchParams.get("sheet") === `prog:${programme.id}`);
  await settle(page, "body");
};

/** Deletes the series recordings a test made, so the shared server keeps its seed only. */
const removeRules = async (page: Page, names: readonly string[]) => {
  const rules = await api(page).get<Rule[]>("/api/rules");
  for (const rule of rules.filter((candidate) => names.includes(candidate.name))) {
    await api(page).delete(`/api/rules/${rule.id}`);
  }
};

test.describe("desktop 1440 × 900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Record every from the programme sheet", async ({ page }) => {
    await seed(page);
    const f1 = await channel(page, "Sportkanal F1 HD");
    const recorded = new Set(
      (await api(page).get<Entry[]>("/api/recordings")).map((entry) => entry.programmeId),
    );
    // A live session the seeded "F1 live sessions" rule leaves alone (Vorberichte, Nachberichte).
    const session = (await guide(page, 72)).find(
      (programme) =>
        programme.channelId === f1.id &&
        programme.title.startsWith("Live F1:") &&
        Date.parse(programme.start) > Date.now() + 10 * 60_000 &&
        !recorded.has(programme.id),
    );
    if (session === undefined) throw new Error("no Live F1 session nobody records");
    try {
      await openByKeyboard(page, session);
      const every = page.getByRole("button", { name: "Every “Live F1”", exact: true });
      await expect(every).toBeVisible();
      await every.click();
      await page.locator(".sheet-footer").getByRole("button", { name: "Record" }).click();

      await expect(page.getByText("Scheduled · by your series recording Live F1")).toBeVisible();
      await expect(page.locator("[data-series-line]")).toContainText(/\d+ will record/u);
      await expect(page.locator(".sheet-footer").getByRole("button")).toHaveText([
        "Skip this one",
        "Series options",
      ]);
      const toast = page.locator(".toast", { hasText: "Series recording added: every “Live F1”" });
      await expect(toast).toBeVisible();
      // One count: the series preview's, in the sheet's line and in the toast alike.
      expect(counted(await toast.textContent())).toBe(
        counted(await page.locator("[data-series-line]").textContent()),
      );

      await toast.getByRole("button", { name: "Undo" }).click();
      await expect
        .poll(async () =>
          (await api(page).get<Rule[]>("/api/rules")).some((rule) => rule.name === "Live F1"),
        )
        .toBe(false);
      await expect(
        page.getByRole("button", { name: "Every “Live F1”", exact: true }),
      ).toBeVisible();
    } finally {
      await removeRules(page, ["Live F1"]);
    }
  });

  test("the collection offer", async ({ page }) => {
    await recordLayoutShifts(page);
    await seed(page);
    // The seeded Formel 1 collection already holds every Live F1 session, so nothing scatters
    // there. The news channel's "Nachrichten" and "Nachrichten am Abend" group by title and date
    // in two places: Record every “Nachrichten” gets the offer.
    const news = await channel(page, "Nachrichten 24");
    const recorded = new Set(
      (await api(page).get<Entry[]>("/api/recordings")).map((entry) => entry.programmeId),
    );
    const bulletin = (await guide(page, 24)).find(
      (programme) =>
        programme.channelId === news.id &&
        programme.title === "Nachrichten" &&
        Date.parse(programme.start) > Date.now() + 10 * 60_000 &&
        !recorded.has(programme.id),
    );
    if (bulletin === undefined) throw new Error("no Nachrichten bulletin nobody records");
    try {
      await openByKeyboard(page, bulletin);
      await page.getByRole("button", { name: "Every “Nachrichten”", exact: true }).click();
      await page.locator(".sheet-footer").getByRole("button", { name: "Record" }).click();
      await expect(page.locator("[data-series-line]")).toBeVisible();
      await afterPaint(page);
      await takeLayoutShifts(page);

      // The offer takes the second line in the same line box: nothing moves when it arrives.
      const offerLine = page.getByText(/^In \d+ places · Group them…$/u);
      await expect(offerLine).toBeVisible();
      await afterPaint(page);
      expect(await takeLayoutShifts(page)).toEqual([]);

      await page.getByRole("button", { name: "Group them…" }).click();
      const name = page.getByLabel("Collection name");
      await expect(name).toBeFocused();
      await expect(name).toHaveValue("Nachrichten");
      await expect(page.locator("[data-offer-preview]")).toContainText(/^Nachrichten › /u);
      await page.getByRole("button", { name: "Group them", exact: true }).click();

      await expect(page.locator("#sr")).toContainText("Grouped as “Nachrichten”");
      await expect
        .poll(async () =>
          (await api(page).get<Named[]>("/api/collections")).some((c) => c.name === "Nachrichten"),
        )
        .toBe(true);
      await page
        .locator(".toast", { hasText: "Grouped as “Nachrichten”" })
        .getByRole("button", { name: "Undo" })
        .click();
      await expect
        .poll(async () =>
          (await api(page).get<Named[]>("/api/collections")).some((c) => c.name === "Nachrichten"),
        )
        .toBe(false);
    } finally {
      await removeRules(page, ["Nachrichten"]);
    }
  });

  test("Repeat state in the programme sheet", async ({ page }) => {
    await seed(page);
    const series = await channel(page, "Serienwelt HD");
    const listed = (await guide(page, 7 * 24)).filter(
      (programme) => programme.channelId === series.id && programme.episode !== undefined,
    );
    const recorded = new Set(
      (await api(page).get<Entry[]>("/api/recordings")).map((entry) => entry.programmeId),
    );
    // The earliest future episode that airs again later: Record series on the first airing.
    const first = listed.find(
      (candidate) =>
        Date.parse(candidate.start) > Date.now() + 10 * 60_000 &&
        !recorded.has(candidate.id) &&
        listed.some(
          (later) =>
            later.id !== candidate.id &&
            episodeOf(later) === episodeOf(candidate) &&
            Date.parse(later.start) >= Date.parse(candidate.end),
        ),
    );
    if (first === undefined) throw new Error("no series episode that airs twice");
    const repeat = listed.find(
      (later) =>
        episodeOf(later) === episodeOf(first) && Date.parse(later.start) >= Date.parse(first.end),
    );
    if (repeat === undefined) throw new Error("no repeat airing");
    try {
      await openByKeyboard(page, first);
      await page.getByRole("button", { name: "All episodes", exact: true }).click();
      await page.locator(".sheet-footer").getByRole("button", { name: "Record" }).click();
      await expect(page.getByText(`by your series recording ${first.title}`)).toBeVisible();

      // The later airing carries the quiet check in the guide …
      await page.goto(`/guide?day=${await dayParam(page, repeat.start)}`);
      await settle(page);
      const cell = await revealCell(page, repeat.id, repeat.start);
      await expect(cell).toHaveAttribute("data-mark", "repeat");
      await expect(cell).toHaveAttribute("aria-label", /, already scheduled$/u);

      // … and its sheet says so instead of offering the record rows.
      await openByKeyboard(page, repeat);
      await expect(page.locator("[data-had-status]")).toContainText(/^Already scheduled /u);
      await expect(page.locator('[aria-label="Record options"]')).toHaveCount(0);
      const footer = page.locator(".sheet-footer");
      await expect(footer.getByRole("button")).toHaveText(["Record anyway", "Series options"]);
      await expect(footer.locator(".btn-primary")).toHaveCount(0);

      await footer.getByRole("button", { name: "Record anyway" }).click();
      await expect(
        page.locator(".toast", { hasText: `Recording ${repeat.title} anyway` }),
      ).toBeVisible();
      await expect
        .poll(async () =>
          (await api(page).get<Entry[]>("/api/recordings")).some(
            (entry) => entry.programmeId === repeat.id && entry.ruleId === undefined,
          ),
        )
        .toBe(true);
    } finally {
      const own = (await api(page).get<Entry[]>("/api/recordings")).find(
        (entry) => entry.programmeId === repeat.id && entry.ruleId === undefined,
      );
      if (own !== undefined) await api(page).delete(`/api/recordings/${own.id}`);
      await removeRules(page, [first.title]);
    }
  });
});
