// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { DateTime } from "effect";
import { MINUTE, UserId } from "@slipstream/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Api } from "~/api/client.ts";
import { ApiProvider } from "~/api/context.tsx";
import { mount } from "~/test/dom.tsx";
import { renderWithApi, type Rendered } from "~/test/render.tsx";
import { HomeScreen } from "./home-page.tsx";

const alex = { id: UserId.make("alex"), displayName: "Alex", role: "admin" as const };

let rendered: Rendered | undefined;

const render = async (setup?: (server: Rendered["server"]) => void) => {
  rendered = await renderWithApi(<HomeScreen me={alex} />);
  setup?.(rendered.server);
  if (setup) await act(() => rendered?.client.invalidateQueries());
  return rendered;
};

const loaded = (view: Rendered) =>
  view.waitFor(() => {
    expect(view.host.querySelector("[data-loading]")).toBeNull();
    expect(view.host.querySelector("[data-home-hero]")?.getAttribute("aria-label")).not.toBe(
      "Loading",
    );
  });

beforeEach(() => {
  localStorage.clear();
});

afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
});

describe("Home", () => {
  it("shows the running recording in the hero", async () => {
    const view = await render();
    await loaded(view);
    const hero = view.host.querySelector("[data-home-hero]");
    expect(hero?.getAttribute("data-state")).toBe("recording");
    expect(hero?.querySelector("h1")?.textContent).toBe("Rennen");
    expect(hero?.textContent).toContain("Watch from start");
    expect(hero?.textContent).toContain("Watch live");
    expect(view.text()).toContain("On now");
    expect(view.text()).toContain("Scheduled recordings");
  });

  it("lists what needs attention, most severe first, and dismisses on this device", async () => {
    const view = await render();
    await loaded(view);
    const cards = () => [...view.host.querySelectorAll("[data-home-attention] .issue")];
    // Three problems after the first, then the one-time notice (not a problem).
    await view.waitFor(() => expect(cards()).toHaveLength(4));
    expect(cards()[0]?.textContent).toContain("Backup IPTV");
    expect(view.text()).toContain("3 more problems");
    // The badge counts the four problems, never the notice.
    const count = () => view.host.querySelector("[data-attention-count]")?.textContent;
    expect(count()).toBe("4");
    await view.click(cards()[0]?.querySelector("button[aria-label='Dismiss']"));
    await view.waitFor(() => expect(cards()).toHaveLength(3));
    expect(count()).toBe("3");
    expect(localStorage.getItem("ss-home.dismissed")).toContain("source:backup-iptv");
  });

  it("gives parallel recordings equal tabs that the arrow keys switch", async () => {
    const view = await render((server) => {
      server.data.recordings = server.data.recordings.map((entry) =>
        entry.id === "tatort-schattenmann"
          ? {
              ...entry,
              state: "recording",
              start: DateTime.makeUnsafe(Date.now() - 100 * MINUTE),
              end: DateTime.makeUnsafe(Date.now() + 10 * MINUTE),
            }
          : entry,
      );
    });
    await loaded(view);
    await view.waitFor(() => expect(view.host.querySelectorAll("[role='tab']")).toHaveLength(2));
    const tabs = () => [...view.host.querySelectorAll<HTMLButtonElement>("[role='tab']")];
    // Alex's rule records the race, so its tab is picked first although the Tatort began earlier.
    expect(tabs().map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    const title = () => view.host.querySelector("[data-home-hero] h1")?.textContent;
    expect(title()).toBe("Rennen");
    await act(async () => {
      tabs()[1]?.focus();
      tabs()[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    expect(tabs().map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false"]);
    expect(title()).not.toBe("Rennen");
    expect(document.activeElement).toBe(tabs()[0]);
  });

  it("welcomes a household without a source", async () => {
    const view = await render((server) => {
      server.data.sources = [];
    });
    await loaded(view);
    await view.waitFor(() =>
      expect(view.host.querySelector("h1")?.textContent).toBe("Almost ready"),
    );
    expect(view.text()).toContain("Add a source");
    expect(view.text()).not.toContain("template");
    expect(view.host.querySelector("[data-home-attention]")).toBeNull();
  });

  it("while loading, renders the layout this device saw last as placeholders", async () => {
    localStorage.setItem(
      "ss-shape.home",
      JSON.stringify({
        hero: "recording",
        heroText: {
          badges: [{ tone: "live", text: "Recording" }],
          eyebrow: "Formel 1 · GP Las Vegas",
          title: "Rennen",
          description: "Recording 17:55–20:30.",
          actions: [{ kind: "primary", label: "Watch from start", icon: "fromStart" }],
        },
        heroIds: ["rennen-las-vegas"],
        issues: [],
        rows: [
          {
            key: "now",
            title: "On now",
            more: { label: "Guide", to: "/guide" },
            cards: [
              {
                title: "heute",
                subtitle: "ZDF · 19:00–19:20",
                isNew: false,
                badges: true,
                when: false,
                progress: true,
              },
            ],
          },
        ],
        tiles: [],
      }),
    );
    // A server that never answers keeps Home loading.
    const pending: Api = {
      call: () => new Promise(() => {}),
      events: () => () => {},
      dispose: async () => {},
    };
    const view = await mount(
      <QueryClientProvider client={new QueryClient()}>
        <ApiProvider api={pending}>
          <HomeScreen me={alex} />
        </ApiProvider>
      </QueryClientProvider>,
    );
    try {
      const scope = view.host.querySelector("[data-home-page]");
      expect(scope?.hasAttribute("data-loading")).toBe(true);
      expect(scope?.getAttribute("aria-busy")).toBe("true");
      expect(view.host.querySelector("[data-home-hero] h1")?.textContent).toBe("Rennen");
      const row = view.host.querySelector("[data-home-row='now']");
      expect(row?.querySelector(".card-title")?.textContent).toBe("heute");
      expect(row?.querySelectorAll(".card")).toHaveLength(1);
      expect(view.host.querySelector("[role='tab']")).toBeNull();
    } finally {
      await view.unmount();
    }
  });
});
