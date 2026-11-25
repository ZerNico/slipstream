// @vitest-environment happy-dom
import { DateTime } from "effect";
import {
  type Source,
  SourceId,
  type SourceStream,
  SourceStreamId,
  viewSource,
} from "@slipstream/domain";
import { act } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mountWithMock } from "../test-support.tsx";
import { StreamPickerDialog } from "./picker-dialog.tsx";

const big: Source = {
  id: SourceId.make("big"),
  name: "Big IPTV",
  config: { _tag: "M3u", playlistUrl: "http://iptv.example/big.m3u" },
  refreshIntervalMinutes: 360,
  headers: {},
  guideCleanup: { removeDuplicates: true, rewrites: [] },
  enabled: true,
  health: "ok",
};

const lines: ReadonlyArray<readonly [group: string, name: string, tvgId?: string]> = [
  ["DE | Sport", "Eurosport 1 HD", "eurosport.de"],
  ["DE | Sport", "Eurosport 1", "eurosport.de"],
  ["DE | Sport", "Sport1 HD"],
  ["DE | Vollprogramm", "ZDF HD", "zdf.de"],
  ["UK | Entertainment", "BBC One HD", "bbc1.uk"],
  ["UK | Entertainment", "BBC One", "bbc1.uk"],
  ["UK | Entertainment", "ITV"],
  ["VOD | Filme", "Film 1"],
];

const streams: SourceStream[] = lines.map(([group, name, tvgId], index) => ({
  id: SourceStreamId.make(`big-${index}`),
  sourceId: big.id,
  upstreamId: `big-${index}`,
  name,
  url: `http://iptv.example/${index}.ts`,
  group,
  ...(tvgId === undefined ? {} : { tvgId }),
  lastSeenAt: DateTime.makeUnsafe(0),
}));

// happy-dom lays nothing out; the list's box gets a size so the virtual list draws rows.
const sized = (name: "clientHeight" | "clientWidth", value: number) => {
  const real = Object.getOwnPropertyDescriptor(Element.prototype, name);
  return {
    stub: () =>
      Object.defineProperty(HTMLElement.prototype, name, {
        configurable: true,
        get(this: HTMLElement) {
          return this.dataset["testid"] === "stream-picker-list"
            ? value
            : (real?.get?.call(this) as number);
        },
      }),
    restore: () => {
      Reflect.deleteProperty(HTMLElement.prototype, name);
    },
  };
};
const sizes = [sized("clientHeight", 600), sized("clientWidth", 900)];
beforeAll(() => sizes.forEach((size) => size.stub()));
afterAll(() => sizes.forEach((size) => size.restore()));

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
  document.body.innerHTML = "";
});

const mountPicker = async () => {
  const view = await mountWithMock(
    <StreamPickerDialog sources={[viewSource(big)]} />,
    "/?dlg=streams:big",
  );
  cleanup = view.cleanup;
  view.server.data.sources.push(big);
  view.server.data.streams.push(...streams);
  await act(() => view.client.resetQueries());
  await view.waitFor(() => expect(view.text()).toContain("UK | Entertainment"));
  return view;
};

/** Types into a field as a person would: React sees a real edit. */
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Reflect.set(HTMLInputElement.prototype, "value", value, input);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const buttonNamed = (name: string) =>
  [...document.querySelectorAll<HTMLElement>("button, [role=checkbox]")].find(
    (element) =>
      element.getAttribute("aria-label") === name || element.textContent?.trim() === name,
  );

describe("stream picker", () => {
  it("ticks the reader's language groups and counts copies as one channel", async () => {
    const view = await mountPicker();
    // English reader: the UK group is ticked and open-able; BBC One HD and SD are one channel.
    expect(view.text()).toContain("3 of 8 selected");
    expect(view.text()).toContain("Add 2 channels");
    expect(buttonNamed("UK | Entertainment")?.getAttribute("aria-checked")).toBe("true");
    expect(buttonNamed("DE | Sport")?.getAttribute("aria-checked")).toBe("false");
    expect(view.text()).toContain("Big IPTV · 8 streams in 4 groups");
  });

  it("searches across groups, ticks a group, and adds what is ticked", async () => {
    const view = await mountPicker();
    const search = document.querySelector<HTMLInputElement>("input[type=search]");
    if (search === null) throw new Error("no search field");
    await type(search, "zdf");
    await view.waitFor(() => expect(view.text()).not.toContain("BBC One HD"));
    expect(view.text()).toContain("ZDF HD");
    // ZDF has a channel with its guide id: adding the stream joins it.
    expect(view.text()).toContain("Joins ZDF");
    // The whole row is the stream's label: a click on its name ticks it.
    await view.click(
      [...document.querySelectorAll("label span")].find((span) => span.textContent === "ZDF HD"),
    );
    await view.waitFor(() => expect(view.text()).toContain("1 joins an existing channel"));

    await type(search, "");
    await view.waitFor(() => expect(view.text()).toContain("UK | Entertainment"));
    expect(view.text()).not.toContain("BBC One HD");
    await view.click(buttonNamed("Show the streams of UK | Entertainment"));
    await view.waitFor(() => expect(view.text()).toContain("BBC One HD"));
    await view.click(buttonNamed("DE | Sport"));
    // Eurosport 1 in HD and SD is one channel, Sport1 another, plus the two UK channels.
    await view.waitFor(() => expect(view.text()).toContain("Add 4 channels"));
    expect(view.text()).toContain("7 of 8 selected");

    const before = view.server.data.channels.length;
    await view.click(buttonNamed("Add 4 channels"));
    await view.waitFor(() => expect(view.server.data.channels.length).toBe(before + 4));
    expect(view.server.data.channels.map((channel) => channel.name)).toEqual(
      expect.arrayContaining(["Eurosport 1 HD", "Sport1 HD", "BBC One HD", "ITV"]),
    );
    expect(
      view.server.data.sources.find((source) => source.id === big.id)?.reviewedAt,
    ).toBeDefined();
  });
});
