// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@slipstream/i18n";
import { type Rendered, renderWithApi } from "~/test/render.tsx";
import { SeriesPage } from "./series-page.tsx";

const page = <SeriesPage />;

let view: Rendered | undefined;
afterEach(async () => {
  setLocale("en");
  await view?.unmount();
  view = undefined;
});

const switches = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('[role="switch"]')];

describe("Series recordings", () => {
  it("is titled Series recordings, without an intro", async () => {
    view = await renderWithApi(page);
    const { host, waitFor } = view;
    await waitFor(() => expect(host.querySelector("[aria-busy]")).toBeNull());
    expect(host.querySelector("h1")?.textContent).toBe("Series recordings");
    expect(host.querySelector(".page-header p")).toBeNull();
    expect(host.textContent).not.toMatch(/\brules?\b/iu);
  });

  it("shows every series recording as a card with its summary, next recording and count", async () => {
    view = await renderWithApi(page);
    const { host, waitFor } = view;
    await waitFor(() => expect(host.querySelector("[aria-busy]")).toBeNull());
    expect(host.querySelectorAll("article")).toHaveLength(4);
    expect(host.textContent).toContain("Sky Sport F1");
    expect(host.textContent).toContain("Next:");
    expect(host.textContent).toMatch(/\d+ recorded/u);
    expect(host.textContent).not.toContain("Start from a template");
    expect(host.querySelector('a[href="/series/formel-1-live"]')).not.toBeNull();
  });

  it("pauses a series recording from its switch", async () => {
    view = await renderWithApi(page);
    const { host, waitFor, click, server } = view;
    // Wait for the real ones: while loading, placeholders stand in their place.
    await waitFor(() => expect(host.querySelector("[aria-busy]")).toBeNull());
    // Each switch says which series recording it turns on and off.
    const first = server.data.rules[0];
    expect(switches(host)[0]?.getAttribute("aria-label")).toBe(
      `Series recording “${first?.name}” on`,
    );
    await click(switches(host)[0]);
    await waitFor(() => expect(server.data.rules[0]?.enabled).toBe(false));
  });

  it("makes other people's series recordings read-only for non-admins", async () => {
    view = await renderWithApi(page);
    const { host, waitFor, server, client } = view;
    server.data.users = server.data.users.map((user) =>
      user.displayName === "Alex" ? { ...user, role: "user" } : user,
    );
    await act(async () => {
      await client.invalidateQueries();
    });
    await waitFor(() => expect(host.textContent).toContain("Kim's series recording, read-only"));
    const tatort = switches(host).find((element) =>
      element.getAttribute("aria-label")?.includes("Kim's series recording"),
    );
    expect(tatort?.hasAttribute("data-disabled")).toBe(true);
  });

  it("points to the guide first when there are none, with New series recording second", async () => {
    view = await renderWithApi(page);
    const { host, waitFor, server, client } = view;
    server.data.rules = [];
    await act(async () => {
      await client.invalidateQueries();
    });
    await waitFor(() => expect(host.textContent).toContain("No series recordings yet"));
    expect(host.querySelectorAll("article")).toHaveLength(0);
    const empty = host.querySelector(".empty")!;
    const actions = [...empty.querySelectorAll("a")];
    expect(actions.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Open the guide", "/guide"],
      ["New series recording", "/series/new"],
    ]);
  });

  it("says it in German", async () => {
    setLocale("de");
    view = await renderWithApi(page);
    const { host, waitFor } = view;
    await waitFor(() => expect(host.querySelector("[aria-busy]")).toBeNull());
    expect(host.querySelector("h1")?.textContent).toBe("Serienaufnahmen");
    expect(host.textContent).toContain("Neue Serienaufnahme");
    expect(host.textContent).not.toContain("Regel");
  });
});
