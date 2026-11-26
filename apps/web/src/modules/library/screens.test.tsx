// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { CollectionId, RecordingId, RuleId } from "@slipstream/domain";

import type { Api } from "~/api/client.ts";
import { ApiProvider } from "~/api/context.tsx";
import type { MockServer } from "~/api/mock/server.ts";
import { mockApi } from "~/api/mock/testing.ts";
import { validateOverlaySearch } from "~/ui/overlay/overlay-state.ts";
import { CollectionEditor } from "./collection-editor.tsx";
import { LibraryPage } from "./library-page.tsx";
import { RecordingPage } from "./recording-page.tsx";
import { ScheduledPage } from "./scheduled-page.tsx";

/*
 * The Recordings screens against the mock API, inside a memory router that takes the overlay
 * params like the app's root, so opening the watch choice shows up in the URL.
 */

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const waitFor = async (check: () => void, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      check();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await act(() => new Promise((resolve) => setTimeout(resolve, 15)));
    }
  }
};
/** The collection editor's "Advanced: what belongs here" toggle. */
const advanced = (view: { host: HTMLElement }) =>
  [...view.host.querySelectorAll("button[aria-expanded]")].find(
    (b) => b.textContent === "Advanced: what belongs here",
  );
const click = async (element: Element | null | undefined) => {
  if (!(element instanceof HTMLElement)) throw new Error("nothing to click");
  await act(async () => element.click());
};

const render = async (
  ui: ReactNode,
  url = "/",
  wrap: (api: Api) => Api = (api) => api,
  setup: (server: MockServer) => void = () => {},
) => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const mocked = mockApi({ autoSignIn: true });
  const { server } = mocked;
  setup(server);
  const api = wrap(mocked.api);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const history = createMemoryHistory({ initialEntries: [url] });
  const rootRoute = createRootRoute({ validateSearch: validateOverlaySearch, component: Outlet });
  const page = createRoute({ getParentRoute: () => rootRoute, path: "$", component: () => ui });
  const index = createRoute({ getParentRoute: () => rootRoute, path: "/", component: () => ui });
  const router = createRouter({ routeTree: rootRoute.addChildren([index, page]), history });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <ApiProvider api={api}>
          <RouterProvider router={router} />
        </ApiProvider>
      </QueryClientProvider>,
    );
  });
  cleanups.push(async () => {
    await act(async () => root.unmount());
    host.remove();
    client.clear();
    await api.dispose();
    await server.dispose();
  });
  const button = (name: string) =>
    [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);
  return {
    host,
    server,
    waitFor,
    click,
    button,
    text: () => host.textContent ?? "",
    search: () => router.state.location.search as Record<string, unknown>,
    path: () => router.state.location.pathname,
  };
};

describe("recording detail of a running recording", () => {
  it("shows REC, the length so far and where it will be exported, and Watch opens the choice", async () => {
    const view = await render(<RecordingPage id={RecordingId.make("rennen-las-vegas")} />);
    await view.waitFor(() => expect(view.text()).toContain("Live F1: Rennen - GP Las Vegas"));
    await view.waitFor(() => expect(view.text()).toContain("so far"));
    expect(view.host.querySelector(".badge-live")?.textContent).toBe("Rec");
    expect(view.text()).toContain("When the recording ends, as");
    expect(view.text()).toContain("/media/tv/Formel 1/2026/GP Las Vegas/Rennen.mkv");
    expect(view.text()).not.toContain("Not exported");
    await view.click(view.button("Watch"));
    await view.waitFor(() => expect(view.search()["choice"]).toBe("rennen-las-vegas"));
  });

  it("routes the artwork's play overlay through the choice too", async () => {
    const view = await render(<RecordingPage id={RecordingId.make("rennen-las-vegas")} />);
    await view.waitFor(() => expect(view.text()).toContain("so far"));
    const overlay = view.host.querySelector<HTMLButtonElement>("button[aria-label='Watch']");
    await view.click(overlay);
    await view.waitFor(() => expect(view.search()["choice"]).toBe("rennen-las-vegas"));
  });

  it("says a failed recording failed, names no file, and offers Delete with an inline confirm", async () => {
    const view = await render(<RecordingPage id={RecordingId.make("tagesschau-failed")} />);
    await view.waitFor(() => expect(view.text()).toContain("Recording failed"));
    expect(view.text()).not.toContain("Exported as");
    expect(view.button("Keep forever")).toBeUndefined();
    await view.click(view.button("Delete"));
    await view.waitFor(() => expect(view.text()).toContain("Delete this recording?"));
    expect(document.activeElement?.textContent).toBe("Delete");
  });

  it("shows a scheduled recording as what will happen: no play, Don't record and Series options", async () => {
    const view = await render(<RecordingPage id={RecordingId.make("tatort-schattenmann")} />);
    await view.waitFor(() => expect(view.text()).toContain("Don't record"));
    expect(view.host.querySelector(".badge-sched")?.textContent).toBe("Scheduled");
    expect(view.text()).toMatch(/Starts (Today|Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} · /u);
    // One decision for the artwork overlay and the primary button: neither is there.
    expect(view.host.querySelector("a[href*='/watch/']")).toBeNull();
    expect(view.host.querySelector("button[aria-label='Play'], button[aria-label='Watch']")).toBe(
      null,
    );
    expect(view.button("Keep forever")).toBeUndefined();
    const terms = [...view.host.querySelectorAll("dt")].map((term) => term.textContent);
    expect(terms).toEqual(expect.arrayContaining(["Will record by"]));
    // The meta line has no size for something not recorded yet.
    expect(view.host.querySelector("[data-meta]")?.textContent).not.toMatch(/\d\s?(GB|MB)/u);
    const edit = [...view.host.querySelectorAll("a")].find(
      (a) => a.textContent === "Series options",
    );
    expect(edit?.getAttribute("href")).toBe("/series/tatort");

    await view.click(view.button("Don't record"));
    await view.waitFor(() => expect(view.path()).toBe("/recordings/scheduled"));
  });

  it("offers Delete, which keeps looking for the repeat, or Delete and stop looking", async () => {
    const id = RecordingId.make("darts-halbfinale-failed");
    // No repeat in the guide yet: the search keeps looking.
    const view = await render(<RecordingPage id={id} />, "/", undefined, (server) => {
      server.data.programmes = server.data.programmes.filter(
        (programme) => !programme.title.endsWith("(Wh.)"),
      );
    });
    // The problem box says where the search for the repeat stands.
    await view.waitFor(() =>
      expect(view.host.querySelector("[data-rerun]")?.textContent).toMatch(
        /^Looking for a repeat until \S+ \d{1,2}$/u,
      ),
    );

    await view.click(view.button("Delete"));
    await view.waitFor(() =>
      expect(view.host.querySelector("[data-delete-confirm='damaged']")).not.toBeNull(),
    );
    await view.click(view.button("Delete and stop looking for a repeat"));
    // Stopped for good: the row is gone, not kept hidden as the chain's anchor.
    await view.waitFor(() =>
      expect(view.server.data.recordings.some((entry) => entry.id === id)).toBe(false),
    );
  });

  it("keeps a damaged recording hidden as the chain's anchor on a plain Delete", async () => {
    const id = RecordingId.make("darts-halbfinale-failed");
    const view = await render(<RecordingPage id={id} />);
    await view.waitFor(() => expect(view.button("Delete")).toBeDefined());
    await view.click(view.button("Delete"));
    await view.waitFor(() =>
      expect(view.host.querySelector("[data-delete-confirm='damaged']")).not.toBeNull(),
    );
    const confirm = view.host.querySelector("[data-delete-confirm]");
    await view.click(
      [...(confirm?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "Delete"),
    );
    await view.waitFor(() =>
      expect(view.server.data.recordings.find((entry) => entry.id === id)?.hiddenAt).toBeDefined(),
    );
  });

  it("names the series recording it is from and links to its options", async () => {
    const view = await render(<RecordingPage id={RecordingId.make("tatort-unter-woelfen")} />);
    await view.waitFor(() => expect(view.text()).toContain("From series recording"));
    const link = view.host.querySelector("dd a[href^='/series/']");
    expect(link?.textContent).toBe("Tatort");
    expect(link?.getAttribute("href")).toBe("/series/tatort");
  });

  it("says so when the recording is gone", async () => {
    const view = await render(<RecordingPage id={RecordingId.make("no-such-recording")} />);
    await view.waitFor(() => expect(view.text()).toContain("This recording is gone"));
  });
});

describe("recording detail of a repeat that replaced its original", () => {
  it("keeps the original by the repeat's id, and brings it back", async () => {
    const view = await render(<RecordingPage id={RecordingId.make("snooker-3")} />);
    await view.waitFor(() => expect(view.text()).toContain("Replaces the recording from"));
    const original = RecordingId.make("snooker-halbfinale-original");
    expect(view.server.data.recordings.find((r) => r.id === original)?.hiddenAt).toBeDefined();
    await view.click(view.button("Keep the original"));
    await view.waitFor(() =>
      expect(view.server.data.recordings.find((r) => r.id === original)?.hiddenAt).toBeUndefined(),
    );
    // The server no longer names a deadline: the button is gone.
    await view.waitFor(() => expect(view.button("Keep the original")).toBeUndefined());
    expect(view.text()).toContain("Replaces the recording from");
  });

  it("offers nothing when the server sends no keepUntil (an anchor, or past 7 days)", async () => {
    const view = await render(
      <RecordingPage id={RecordingId.make("snooker-3")} />,
      "/",
      (api) => api,
      (server) => {
        server.data.recordings = server.data.recordings.map((entry) =>
          entry.id === "snooker-halbfinale-original"
            ? { ...entry, hiddenReason: "deleted" as const }
            : entry,
        );
      },
    );
    await view.waitFor(() => expect(view.text()).toContain("Replaces the recording from"));
    expect(view.button("Keep the original")).toBeUndefined();
  });
});

describe("library", () => {
  it("shows Recording now, then collections, then shows and films", async () => {
    const view = await render(<LibraryPage view="collections" filter="all" query="" />);
    await view.waitFor(() => expect(view.text()).toContain("Recording now"));
    expect(view.host.querySelector("a[aria-label='Formel 1']")).not.toBeNull();
    expect(view.text()).toContain("Shows & films");
  });

  it("offers to group a scattering series recording, and never again after No thanks", async () => {
    const view = await render(<LibraryPage view="collections" filter="all" query="" />);
    const offer = () => view.host.querySelector("[data-offer='live-f1-academy']");
    await view.waitFor(() => expect(offer()).not.toBeNull());
    expect(offer()?.textContent).toContain("is in 3 places. Group it?");
    await view.click(view.button("No thanks"));
    await view.waitFor(() => expect(offer()).toBeNull());
    expect(
      view.server.data.rules.find((rule) => rule.id === "live-f1-academy")?.offerDeclined,
    ).toBe(true);
  });

  it("groups a series recording's programmes in a collection that follows it", async () => {
    const view = await render(<LibraryPage view="collections" filter="all" query="" />);
    await view.waitFor(() => expect(view.button("Group them")).toBeDefined());
    await view.click(view.button("Group them"));
    await view.waitFor(() =>
      expect(
        view.server.data.collections.find((c) => c.follows?.ruleId === "live-f1-academy"),
      ).toBeDefined(),
    );
  });

  it("explains an empty search and offers to clear it", async () => {
    const view = await render(<LibraryPage view="collections" filter="all" query="zzzz" />);
    await view.waitFor(() => expect(view.text()).toContain("Nothing matches “zzzz”"));
    expect(view.button("Clear filters")).toBeDefined();
  });
});

describe("scheduled", () => {
  it("writes days in the pills' notation without repeating the day in every row", async () => {
    const view = await render(<ScheduledPage />);
    await view.waitFor(() => expect(view.text()).toContain("Darts: Grand Slam - Finale"));
    const headings = [...view.host.querySelectorAll("h3")].map((h) => h.textContent ?? "");
    expect(headings[0]).toMatch(/^(Today|Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2}$/u);
    const firstRow = view.host.querySelector("section .grid > div");
    expect(firstRow?.textContent ?? "").not.toContain(headings[0] ?? "-");
  });

  it("stays the day skeleton until the conflicts have answered, then shows the days", async () => {
    // The recordings are there (as Home leaves them); the conflicts wait until released.
    const gate = Promise.withResolvers<void>();
    const held = (api: Api): Api => ({
      ...api,
      call: (f) =>
        api.call((client) => {
          const conflicts = ((request) =>
            Effect.promise(() => gate.promise).pipe(
              Effect.andThen(client.recordings.conflicts(request)),
            )) as typeof client.recordings.conflicts;
          return f({ ...client, recordings: { ...client.recordings, conflicts } });
        }),
    });
    const view = await render(<ScheduledPage />, "/", held);
    await view.waitFor(() =>
      expect(view.host.querySelector("[data-scheduled-skeleton]")).not.toBeNull(),
    );
    // The recordings have answered (the tab counts them): still no real day, no row.
    await view.waitFor(() => expect(view.text()).toMatch(/Scheduled\d+/u));
    expect(view.host.querySelector("[data-scheduled-skeleton]")).not.toBeNull();
    expect(view.host.querySelector("section[aria-label]")).toBeNull();
    expect(view.text()).not.toContain("Darts: Grand Slam - Finale");
    gate.resolve();
    await view.waitFor(() => expect(view.text()).toContain("only 1 stream is free then"));
    expect(view.host.querySelector("[data-scheduled-skeleton]")).toBeNull();
  });

  it("skips a conflicting recording from the resolution box", async () => {
    const view = await render(<ScheduledPage />);
    await view.waitFor(() => expect(view.text()).toContain("only 1 stream is free then"));
    await view.click(view.button("Skip"));
    await view.waitFor(() => expect(view.text()).not.toContain("Darts: Grand Slam - Finale"));
  });
});

describe("collection editor", () => {
  it("says a collection that no longer exists is gone, without the editor's heading", async () => {
    const view = await render(<CollectionEditor id={CollectionId.make("deleted-elsewhere")} />);
    await view.waitFor(() => expect(view.text()).toContain("This collection no longer exists"));
    expect(view.host.querySelector("h1")?.textContent).toBe("This collection no longer exists");
    expect(view.text()).not.toContain("Edit collection");
    const links = [...view.host.querySelectorAll("a[href='/recordings']")];
    expect(links.map((link) => link.textContent)).toContain("Back to Recordings");
  });

  it("prefills the name from the group and selects it, so typing replaces it", async () => {
    const view = await render(<CollectionEditor from="films" />);
    await view.waitFor(() => {
      const input = view.host.querySelector<HTMLInputElement>("input[placeholder='e.g. Formel 1']");
      expect(input?.value).toBe("Films");
      expect(document.activeElement).toBe(input);
      expect(input?.selectionStart).toBe(0);
      expect(input?.selectionEnd).toBe("Films".length);
    });
  });

  it("previews what belongs in it, and refuses to save without a name", async () => {
    const view = await render(<CollectionEditor />);
    await view.waitFor(() => expect(view.host.querySelector("[aria-busy]")).toBeNull());
    expect(view.text()).toContain("0 placed");
    await view.click(view.button("Create collection"));
    await view.waitFor(() => expect(view.text()).toContain("Give the collection a name."));
  });

  it("keeps Advanced closed for a collection with conditions, open for a new one", async () => {
    const existing = await render(<CollectionEditor id={CollectionId.make("formel-1")} />);
    await existing.waitFor(() => expect(existing.host.querySelector("[aria-busy]")).toBeNull());
    expect(advanced(existing)?.getAttribute("aria-expanded")).toBe("false");
    // The conditions are there, behind the disclosure, and the overlap check with them.
    await existing.click(advanced(existing));
    expect(advanced(existing)?.getAttribute("aria-expanded")).toBe("true");
    expect(existing.text()).toContain("Title starts with");

    const fresh = await render(<CollectionEditor />);
    await fresh.waitFor(() => expect(fresh.host.querySelector("[aria-busy]")).toBeNull());
    expect(advanced(fresh)?.getAttribute("aria-expanded")).toBe("true");
  });

  it("shows what a linked collection follows and can use its own conditions instead", async () => {
    const view = await render(
      <CollectionEditor id={CollectionId.make("formel-1")} />,
      "/",
      (api) => api,
      (server) => {
        server.data.collections = server.data.collections.map((collection) =>
          collection.id === "formel-1"
            ? {
                ...collection,
                follows: { ruleId: RuleId.make("formel-1-live"), ruleName: "Formel 1 live" },
              }
            : collection,
        );
      },
    );
    const follows = () => view.host.querySelector("[data-follows]");
    await view.waitFor(() => expect(view.host.querySelector("[aria-busy]")).toBeNull());
    await view.waitFor(() => expect(follows()).not.toBeNull());
    // The mock keeps the collection's matcher; the server answers with the effective one.
    expect(follows()?.textContent).toContain(
      "Follows the series recording “Formel 1 live”: any channel, titles starting with “F1:” and “Live F1:”",
    );

    const options = follows()?.querySelector("a");
    expect(options?.textContent).toBe("Series options");
    expect(options?.getAttribute("href")).toBe("/series/formel-1-live");
    // Its conditions are the series recording's: no fields to change them.
    expect(view.text()).not.toContain("Title starts with");
    await view.click(view.button("Advanced: what belongs here"));
    await view.click(view.button("Use its own conditions instead"));
    await view.waitFor(() => expect(follows()).toBeNull());
    expect(view.text()).toContain("Title starts with");
    expect(view.server.data.collections.find((c) => c.id === "formel-1")?.follows).toBeUndefined();
  });

  it("opens an existing collection with its layout as words", async () => {
    const view = await render(<CollectionEditor id={CollectionId.make("formel-1")} />);
    await view.waitFor(() => expect(view.text()).toContain("Save collection"));
    expect(view.text()).toContain("Year");
    expect(view.text()).toContain("Event");
    expect(view.text()).toContain("Programme");
    expect(view.text()).not.toContain("{event}");
    await view.waitFor(() => expect(view.text()).toMatch(/\d+ placed/u));
  });
});
