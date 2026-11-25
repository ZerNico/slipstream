// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getTimeZone, setRegion, setTimeZone } from "@slipstream/i18n";
import { formatClock, formatDay, formatSlot } from "~/i18n/formats.ts";
import { renderWithApi, type Rendered } from "~/test/render.tsx";
import { HouseholdZone } from "./household-zone.tsx";

// The device sits far from the household (the mock's Europe/Berlin), so a time written in the
// device's zone cannot pass for the household's.
beforeAll(() => {
  process.env.TZ = "Pacific/Kiritimati";
});

let rendered: Rendered | undefined;
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
  setTimeZone(undefined);
  setRegion(undefined);
});

/** 23:30 UTC: 00:30 the next day in Berlin, 13:30 the next afternoon in Kiritimati. */
const at = Date.parse("2026-11-22T23:30:00Z");

function Times() {
  return (
    <p>
      <span data-testid="clock">{formatClock(at)}</span>
      <span data-testid="day">{formatDay(at)}</span>
      <span data-testid="slot">{formatSlot(at, at + 3_600_000)}</span>
    </p>
  );
}

describe("HouseholdZone", () => {
  it("writes clock times and days in the household's zone, not the device's", async () => {
    setRegion("GB");
    rendered = await renderWithApi(
      <HouseholdZone>
        <Times />
      </HouseholdZone>,
    );
    const { host, waitFor } = rendered;
    const read = (id: string) => host.querySelector(`[data-testid="${id}"]`)?.textContent;
    await waitFor(() => expect(read("clock")).toBe("00:30"));
    expect(getTimeZone()).toBe("Europe/Berlin");
    expect(read("day")).toBe("Mon 23 Nov");
    expect(read("slot")).toBe("Mon 23 Nov · 00:30–01:30");
  });

  it("follows the server when the household moves", async () => {
    setRegion("GB");
    rendered = await renderWithApi(
      <HouseholdZone>
        <Times />
      </HouseholdZone>,
    );
    const { host, server, client, waitFor } = rendered;
    const read = (id: string) => host.querySelector(`[data-testid="${id}"]`)?.textContent;
    await waitFor(() => expect(read("clock")).toBe("00:30"));
    server.data.system = { ...server.data.system, timeZone: "America/New_York" };
    await client.invalidateQueries();
    await waitFor(() => expect(read("clock")).toBe("18:30"));
    expect(read("day")).toBe("Sun 22 Nov");
  });
});
