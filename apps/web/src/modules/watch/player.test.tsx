// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChannelId, RecordingId } from "@slipstream/domain";
import { renderWithApi, type Rendered } from "~/test/render.tsx";
import { prefKeys } from "./player-prefs.ts";
import { mockBufferMillis } from "~/api/mock/playback.ts";
import { LivePlayerPage, RangePlayerPage, RecordingPlayerPage } from "./watch-page.tsx";

let rendered: Rendered | undefined;
beforeEach(() => localStorage.clear());
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
});

const press = async (key: string) => {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
};

const panel = () => rendered?.host.querySelector("aside");

describe("the recording player", () => {
  it("shows the recording, its badge and a statement when the browser can't play HLS", async () => {
    rendered = await renderWithApi(
      <RecordingPlayerPage id={RecordingId.make("rennen-las-vegas")} search={{ at: "live" }} />,
    );
    await rendered.waitFor(() =>
      expect(rendered?.text()).toContain("Live F1: Rennen - GP Las Vegas"),
    );
    expect(rendered.text()).toContain("Recording");
    await rendered.waitFor(() =>
      expect(rendered?.text()).toContain("This browser can't play the stream"),
    );
    expect(rendered.host.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("opens the panel with I on the weekend's sessions and closes it with Esc", async () => {
    rendered = await renderWithApi(
      <RecordingPlayerPage id={RecordingId.make("weekend-3")} search={{}} />,
    );
    await rendered.waitFor(() => expect(rendered?.text()).toContain("Up next"));
    expect(panel()?.hasAttribute("inert")).toBe(true);
    await press("i");
    expect(panel()?.hasAttribute("inert")).toBe(false);
    expect(panel()?.textContent).toContain("2. Freies Training");
    await press("Escape");
    expect(panel()?.hasAttribute("inert")).toBe(true);
  });

  it("remembers mute and Fill/Fit on this device", async () => {
    rendered = await renderWithApi(
      <RecordingPlayerPage id={RecordingId.make("weekend-3")} search={{}} />,
    );
    await rendered.waitFor(() => expect(rendered?.text()).toContain("3. Freies Training"));
    await press("m");
    expect(localStorage.getItem(prefKeys.muted)).toBe("true");
    expect(rendered.host.querySelector('[aria-label="Unmute"]')).not.toBeNull();
    await press("z");
    expect(localStorage.getItem(prefKeys.fit)).toBe("fit");
    expect(rendered.host.querySelector("video")?.className).toContain("object-contain");
    await press("ArrowUp");
    expect(localStorage.getItem(prefKeys.muted)).toBe("false");
    expect(localStorage.getItem(prefKeys.volume)).toBe("100");
  });

  it("explains a recording that has nothing to play yet", async () => {
    rendered = await renderWithApi(
      <RecordingPlayerPage id={RecordingId.make("tatort-schattenmann")} search={{}} />,
    );
    await rendered.waitFor(() => expect(rendered?.text()).toContain("Nothing recorded yet"));
  });

  it("says so when the recording doesn't exist", async () => {
    rendered = await renderWithApi(
      <RecordingPlayerPage id={RecordingId.make("nope")} search={{}} />,
    );
    await rendered.waitFor(() =>
      expect(rendered?.text()).toContain("This isn't available to watch"),
    );
  });
});

describe("the live player", () => {
  it("explains the stream limit with the stream model when no stream is free", async () => {
    rendered = await renderWithApi(<LivePlayerPage channelId={ChannelId.make("sky-sport-news")} />);
    await rendered.waitFor(() => expect(rendered?.text()).toContain("No free stream for watching"));
    expect(rendered.text()).toContain("Try again");
    expect(rendered.text()).toContain("Back to the guide");
  });

  it("plays a channel live with its channel in the header", async () => {
    rendered = await renderWithApi(<LivePlayerPage channelId={ChannelId.make("zdf")} />);
    await rendered.waitFor(() => expect(rendered?.text()).toContain("ZDF"));
  });
});

describe("the range player", () => {
  const HOUR = 3_600_000;

  it("plays a stretch of the pause buffer as a finished programme", async () => {
    const start = Date.now() - 2 * HOUR;
    rendered = await renderWithApi(
      <RangePlayerPage channelId={ChannelId.make("zdf")} range={{ start, end: start + HOUR }} />,
    );
    await rendered.waitFor(() => expect(rendered?.text()).toContain("ZDF"));
    // happy-dom plays no HLS: the session was granted, so the browser is what stops it.
    await rendered.waitFor(() =>
      expect(rendered?.text()).toContain("This browser can't play the stream"),
    );
    expect(rendered.text()).toContain("Back to the guide");
  });

  it("says so when the buffer no longer holds the range", async () => {
    const start = Date.now() - mockBufferMillis - 2 * HOUR;
    rendered = await renderWithApi(
      <RangePlayerPage channelId={ChannelId.make("zdf")} range={{ start, end: start + HOUR }} />,
    );
    await rendered.waitFor(() =>
      expect(rendered?.text()).toContain("This programme is no longer in pause & rewind."),
    );
    expect(rendered.text()).not.toContain("Try again");
  });

  it("says a broken link isn't available", async () => {
    rendered = await renderWithApi(
      <RangePlayerPage channelId={ChannelId.make("zdf")} range={undefined} />,
    );
    await rendered.waitFor(() =>
      expect(rendered?.text()).toContain("This isn't available to watch"),
    );
  });
});
