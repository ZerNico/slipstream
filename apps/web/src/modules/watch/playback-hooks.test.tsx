// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { DateTime, Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaybackSession } from "@slipstream/api";
import { MINUTE, PlaybackSessionId, RecordingId } from "@slipstream/domain";
import type { Api, SlipstreamClient } from "~/api/client.ts";
import { ApiProvider } from "~/api/context.tsx";
import { renderWithApi, type Rendered } from "~/test/render.tsx";
import { browserCapabilities } from "./capabilities.ts";
import { useHlsPlayback } from "./use-hls-playback.ts";
import { usePlaybackSession } from "./use-playback-session.ts";

/*
 * hls.js stands in as a fake: happy-dom has no Media Source Extensions, and what is tested is
 * what the hook asks of hls.js (which URL, a reload or not, a retry), not hls.js itself.
 */
const fake = vi.hoisted(() => ({ supported: false, instances: [] as FakeHls[] }));

interface FakeHls {
  readonly config: { xhrSetup?: (xhr: XMLHttpRequest, url: string) => void };
  readonly loaded: string[];
  levels: unknown[];
  latestLevelDetails: { live: boolean } | undefined;
  startLoads: number;
  destroyed: boolean;
  emit: (event: string, data: unknown) => void;
}

vi.mock("hls.js", () => {
  class Hls implements FakeHls {
    static isSupported = () => fake.supported;
    readonly config: FakeHls["config"];
    readonly loaded: string[] = [];
    levels: unknown[] = [];
    latestLevelDetails: { live: boolean } | undefined = undefined;
    liveSyncPosition = null;
    startLoads = 0;
    destroyed = false;
    private readonly handlers = new Map<string, ((event: string, data: unknown) => void)[]>();
    constructor(config: FakeHls["config"]) {
      this.config = config;
      fake.instances.push(this);
    }
    on(event: string, handler: (event: string, data: unknown) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    }
    emit(event: string, data: unknown) {
      for (const handler of this.handlers.get(event) ?? []) handler(event, data);
    }
    loadSource(url: string) {
      this.loaded.push(url);
    }
    attachMedia() {}
    startLoad() {
      this.startLoads += 1;
    }
    recoverMediaError() {}
    destroy() {
      this.destroyed = true;
    }
  }
  const names = [
    "LEVEL_LOADED",
    "MANIFEST_PARSED",
    "AUDIO_TRACKS_UPDATED",
    "AUDIO_TRACK_SWITCHED",
    "SUBTITLE_TRACKS_UPDATED",
    "SUBTITLE_TRACK_SWITCH",
    "FRAG_LOADED",
    "ERROR",
  ];
  return {
    default: Hls,
    Events: Object.fromEntries(names.map((name) => [name, name])),
    ErrorTypes: { NETWORK_ERROR: "networkError", MEDIA_ERROR: "mediaError" },
  };
});

let rendered: Rendered | undefined;
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
  fake.supported = false;
  fake.instances.length = 0;
  vi.useRealTimers();
});

/** Opens a session for a finished recording and shows what came back. */
function Session() {
  const { query, session } = usePlaybackSession(
    { _tag: "Recording", recordingId: RecordingId.make("presse-qualifying") },
    { _tag: "Auto" },
  );
  return (
    <p>
      <span data-testid="status">{query.status}</span>
      <span data-testid="url">{session?.playlistUrl ?? ""}</span>
      <span data-testid="start">{session?.startAt === undefined ? "none" : "set"}</span>
    </p>
  );
}

/** A player without Media Source Extensions or native HLS (happy-dom has neither). */
function Player() {
  const { videoRef, status } = useHlsPlayback("/hls/test.m3u8", { kind: "start" });
  return (
    <div>
      <video ref={videoRef} />
      <span data-testid="playback">{status}</span>
    </div>
  );
}

const text = (id: string) => rendered?.host.querySelector(`[data-testid="${id}"]`)?.textContent;

describe("playback hooks", () => {
  it("opens a playback session with the browser's capabilities", async () => {
    rendered = await renderWithApi(<Session />);
    await rendered.waitFor(() => expect(text("status")).toBe("success"));
    expect(text("url")).toContain(".m3u8");
    // Without Media Source Extensions the probe reports nothing it can decode, never throws.
    expect(browserCapabilities().video).toEqual([]);
  });

  it("says unsupported where neither hls.js nor native HLS can play", async () => {
    rendered = await renderWithApi(<Player />);
    await rendered.waitFor(() => expect(text("playback")).toBe("unsupported"));
  });
});

/** Mounts `ui` against `api`; returns its host and how to render again or unmount. */
const mount = async (ui: ReactNode, api: Api) => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const render = (next: ReactNode) =>
    act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <ApiProvider api={api}>{next}</ApiProvider>
        </QueryClientProvider>,
      );
    });
  await render(ui);
  return {
    render,
    text: (id: string) => host.querySelector(`[data-testid="${id}"]`)?.textContent,
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
      client.clear();
    },
  };
};

/** Moves the fake clock on and lets React and the promises it started settle. */
const advance = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));

/** One session answer: the playlist with token `t<token>`, expiring an hour from now. */
const answer = (token: number): PlaybackSession => ({
  id: PlaybackSessionId.make("session-1"),
  playlistUrl: `/hls/recordings/r1.m3u8?token=t${token}`,
  expiresAt: DateTime.makeUnsafe(Date.now() + 60 * MINUTE),
});

/** A server whose sessions expire an hour after each answer, with a new token each time. */
const tokenServer = () => {
  const calls = { updates: 0 };
  // Only the three calls a session makes; the rest of the client is never reached.
  const client: SlipstreamClient = Object.assign(Object.create(null), {
    playback: {
      createSession: () => Effect.sync(() => answer(0)),
      updateSession: () =>
        Effect.sync(() => {
          calls.updates += 1;
          return answer(calls.updates);
        }),
      endSession: () => Effect.void,
    },
  });
  const api: Api = {
    call: (f) => Effect.runPromise(f(client)),
    events: () => () => {},
    dispose: async () => {},
  };
  return { api, calls };
};

/** An API nothing in the hls.js tests calls. */
const noApi: Api = {
  call: () => Promise.reject(new Error("not called")),
  events: () => () => {},
  dispose: async () => {},
};

describe("playlist token renewal", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 23, 20) });
  });

  it("renews five minutes before expiry, after every renewal, and stops on unmount", async () => {
    const { api, calls } = tokenServer();
    const view = await mount(<Session />, api);
    await advance(0);
    expect(view.text("url")).toBe("/hls/recordings/r1.m3u8?token=t0");

    await advance(55 * MINUTE - 1000);
    expect(calls.updates).toBe(0);
    await advance(1000);
    expect(calls.updates).toBe(1);
    expect(view.text("url")).toBe("/hls/recordings/r1.m3u8?token=t1");

    // The renewed session expires an hour from its answer: the next renewal 55 min on.
    await advance(55 * MINUTE);
    expect(calls.updates).toBe(2);
    expect(view.text("url")).toBe("/hls/recordings/r1.m3u8?token=t2");

    await view.unmount();
    await advance(120 * MINUTE);
    expect(calls.updates).toBe(2);
  });
});

/** A live player on `src` with the test's `renew`. */
function Harness({ src, renew }: { src: string; renew: () => Promise<string | undefined> }) {
  const { videoRef, status } = useHlsPlayback(src, { kind: "live" }, { renew });
  return (
    <div>
      <video ref={videoRef} />
      <span data-testid="playback">{status}</span>
    </div>
  );
}

const first = "/hls/live/ard.m3u8?session=s&token=t0";
const renewed = "/hls/live/ard.m3u8?session=s&token=t1";
const absolute = (url: string) => new URL(url, window.location.href).href;

/** A `renew` that hands out the next token and counts how often it was asked. */
const renewer = () => vi.fn<() => Promise<string | undefined>>(() => Promise.resolve(renewed));

/** What hls.js would request for `url` after the xhrSetup hook had its say. */
const requested = (hls: FakeHls, url: string): string => {
  const xhr = new XMLHttpRequest();
  const open = vi.spyOn(xhr, "open").mockImplementation(() => {});
  hls.config.xhrSetup?.(xhr, new URL(url, window.location.href).href);
  const call = open.mock.calls[0];
  return call === undefined ? url : String(call[1]);
};

/** The one hls.js instance the player made. */
const onlyHls = (): FakeHls => {
  expect(fake.instances).toHaveLength(1);
  const [hls] = fake.instances;
  if (hls === undefined) throw new Error("no hls.js instance");
  return hls;
};

describe("hls.js playback with a renewed token", () => {
  beforeEach(() => {
    fake.supported = true;
  });

  it("swaps a renewed URL into the running load, without reloading or a new instance", async () => {
    const renew = renewer();
    const view = await mount(<Harness src={first} renew={renew} />, noApi);
    const hls = onlyHls();
    expect(hls.loaded).toEqual([first]);

    await view.render(<Harness src="/hls/live/ard.m3u8?session=s&token=t9" renew={renew} />);
    // Still the one instance and the one load: the picture never blinks.
    expect(onlyHls()).toBe(hls);
    expect(hls.destroyed).toBe(false);
    expect(hls.loaded).toHaveLength(1);
    // The next playlist reload goes out with the fresh token.
    expect(requested(hls, first)).toBe(absolute("/hls/live/ard.m3u8?session=s&token=t9"));
    expect(renew).not.toHaveBeenCalled();

    // Another playlist altogether loads afresh.
    await view.render(<Harness src="/hls/live/zdf.m3u8?session=s&token=t0" renew={renew} />);
    expect(fake.instances).toHaveLength(2);
    expect(hls.destroyed).toBe(true);
    await view.unmount();
  });

  it("renews and retries once on a 403, and fails on the second", async () => {
    const renew = renewer();
    const view = await mount(<Harness src={first} renew={renew} />, noApi);
    const hls = onlyHls();
    hls.levels = [{}];
    const refused = {
      fatal: true,
      type: "networkError",
      details: "fragLoadError",
      response: { code: 403, text: "Forbidden" },
    };

    await act(async () => hls.emit("ERROR", refused));
    expect(renew).toHaveBeenCalledTimes(1);
    expect(hls.startLoads).toBe(1);
    expect(hls.destroyed).toBe(false);
    expect(requested(hls, first)).toBe(absolute(renewed));
    expect(view.text("playback")).toBe("loading");

    await act(async () => hls.emit("ERROR", refused));
    expect(renew).toHaveBeenCalledTimes(1);
    expect(hls.destroyed).toBe(true);
    expect(view.text("playback")).toBe("failed");
    await view.unmount();
  });

  it("allows another renewal once a segment loaded again", async () => {
    const renew = renewer();
    const view = await mount(<Harness src={first} renew={renew} />, noApi);
    const hls = onlyHls();
    hls.levels = [{}];
    const refused = { fatal: true, type: "networkError", response: { code: 401, text: "" } };
    await act(async () => hls.emit("ERROR", refused));
    await act(async () => hls.emit("FRAG_LOADED", {}));
    await act(async () => hls.emit("ERROR", refused));
    expect(renew).toHaveBeenCalledTimes(2);
    expect(view.text("playback")).not.toBe("failed");
    await view.unmount();
  });
});
