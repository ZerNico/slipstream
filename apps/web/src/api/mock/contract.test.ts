import { afterEach, describe, expect, it } from "vitest";
import { DateTime } from "effect";
import type { PlaybackSessionRequest, ServerEvent } from "@slipstream/api";
import { ChannelId, DAY, HOUR, RecordingId, RuleId, UserId } from "@slipstream/domain";
import { clientsLayer, makeApi } from "../client.ts";
import { problemOf } from "../errors.ts";
import { mockPin } from "./household.ts";
import { fullChannel, mockBufferMillis } from "./playback.ts";
import { makeMockServer } from "./server.ts";
import { mockOrigin } from "./household.ts";

/** The shared client against a fresh mock, signed in as the admin fixture. */
const setup = () => {
  const server = makeMockServer({ autoSignIn: true });
  const api = makeApi(
    clientsLayer({
      baseUrl: mockOrigin,
      fetch: (input, init) => server.handler(new Request(input, init)),
    }),
  );
  dispose = async () => {
    await api.dispose();
    await server.dispose();
  };
  return { server, api };
};

let dispose: (() => Promise<void>) | undefined;
afterEach(async () => {
  await dispose?.();
  dispose = undefined;
});

const rejection = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return problemOf(error);
  }
  throw new Error("expected the call to fail");
};

const range = (fromAgo: number, toAgo: number) => ({
  start: DateTime.makeUnsafe(Date.now() - fromAgo),
  end: DateTime.makeUnsafe(Date.now() - toAgo),
});

/** A session request from a plain H.264/AAC browser. */
const request = (source: PlaybackSessionRequest["source"]): PlaybackSessionRequest => ({
  source,
  capabilities: {
    video: [{ codec: "h264", profiles: ["high"], maxWidth: 1920, maxHeight: 1080 }],
    audio: ["aac"],
    audioPassthrough: [],
    hdr: false,
    canDeinterlace: false,
  },
  quality: { _tag: "Auto" },
});

describe("mock matches the server's contract", () => {
  it("starts over within the buffer and answers RangeNotCaptured beyond it", async () => {
    const { api } = setup();
    const channelId = ChannelId.make("das-erste");
    const within = await api.call((c) =>
      c.playback.createSession({
        payload: request({ _tag: "Range", channelId, range: range(HOUR, 0) }),
      }),
    );
    expect(within.startAt).toBeDefined();
    const old = range(mockBufferMillis + HOUR, mockBufferMillis);
    expect(
      await rejection(
        api.call((c) =>
          c.playback.createSession({ payload: request({ _tag: "Range", channelId, range: old }) }),
        ),
      ),
    ).toMatchObject({ _tag: "RangeNotCaptured", channelId });
  });

  it("answers StreamLimitReached with a typed reason on the full channel", async () => {
    const { api } = setup();
    expect(
      await rejection(
        api.call((c) =>
          c.playback.createSession({
            payload: request({ _tag: "Live", channelId: fullChannel }),
          }),
        ),
      ),
    ).toMatchObject({ _tag: "StreamLimitReached", reason: "sourceFull" });
  });

  it("lets only a rule's owner or an admin change it (canEditRule)", async () => {
    const { api } = setup();
    // Alex is an admin: Kim's rule is theirs to change too.
    const tatort = RuleId.make("tatort");
    const renamed = await api.call((c) =>
      c.rules.update({ params: { ruleId: tatort }, payload: { name: "Tatort Sundays" } }),
    );
    expect(renamed.name).toBe("Tatort Sundays");
    await api.call((c) =>
      c.profiles.switch({ params: { userId: UserId.make("kim") }, payload: { secret: mockPin } }),
    );
    const darts = RuleId.make("darts");
    expect(
      await rejection(
        api.call((c) => c.rules.update({ params: { ruleId: darts }, payload: { enabled: false } })),
      ),
    ).toMatchObject({ _tag: "Forbidden" });
    expect(
      await rejection(api.call((c) => c.rules.remove({ params: { ruleId: darts }, query: {} }))),
    ).toMatchObject({ _tag: "Forbidden" });
    const own = await api.call((c) =>
      c.rules.update({ params: { ruleId: tatort }, payload: { enabled: false } }),
    );
    expect(own.enabled).toBe(false);
  });

  it("tells the owners a deleted recording is gone", async () => {
    const { api, server } = setup();
    const heard: ServerEvent[] = [];
    const race = RecordingId.make("rennen-las-vegas");
    const owners = server.data.recordings.find((entry) => entry.id === race)?.ownerIds;
    // Listen the way the SSE route does: through the server's own event stream.
    const stop = server.subscribe((event) => heard.push(event));
    try {
      await api.call((c) => c.recordings.remove({ params: { recordingId: race }, query: {} }));
    } finally {
      stop();
    }
    expect(heard).toEqual([{ _tag: "RecordingRemoved", recordingId: race, ownerIds: owners }]);
    expect(server.data.recordings.some((entry) => entry.id === race)).toBe(false);
  });
});

const now = () => Date.now();

describe("mock serves the recording model (recording model §7)", () => {
  it("marks Kim's Tatort repeat on ZDF as Owned for Alex, in the guide and the record options", async () => {
    const { api, server } = setup();
    const onOne = server.data.programmes.find(
      (programme) => programme.channelId === "zdf" && programme.title === "Tatort",
    );
    if (onOne === undefined) throw new Error("fixture: Tatort on ONE");
    const repeats = await api.call((c) =>
      c.guide.repeats({
        query: { from: DateTime.makeUnsafe(now()), to: DateTime.makeUnsafe(now() + 2 * DAY) },
      }),
    );
    const owned = repeats.find((repeat) => repeat.programmeId === onOne.id);
    expect(owned).toMatchObject({
      of: { recordingId: "tatort-unter-woelfen", channelId: "das-erste", state: "completed" },
    });
    expect(owned).not.toHaveProperty("ruleId");
    const options = await api.call((c) =>
      c.programmes.recordOptions({ params: { programmeId: onOne.id } }),
    );
    expect(options.status).toMatchObject({ _tag: "Owned" });
  });

  it("plans the marked repeat of a failed series recording and reports the chain", async () => {
    const { api } = setup();
    const failed = await api.call((c) =>
      c.recordings.get({ params: { recordingId: RecordingId.make("darts-halbfinale-failed") } }),
    );
    expect(failed.rerun?.state).toBe("scheduled");
    // A plain Delete keeps looking: the row is hidden from the list, not gone.
    const list = await api.call((c) => c.recordings.list({ query: {} }));
    expect(list.some((entry) => entry.id === failed.id)).toBe(true);
  });

  it("offers to group the scattered F1 Academy sessions, and groups them in a linked collection", async () => {
    const { api } = setup();
    const academy = RuleId.make("live-f1-academy");
    const { offer } = await api.call((c) => c.rules.offer({ params: { ruleId: academy } }));
    expect(offer).toMatchObject({ name: "Live F1 Academy", groups: 3 });
    const collection = await api.call((c) =>
      c.rules.group({ params: { ruleId: academy }, payload: { name: "F1 Academy" } }),
    );
    expect(collection.follows).toEqual({ ruleId: academy, ruleName: "Live F1 Academy:" });
    expect(collection.matcher.title).toEqual([
      { _tag: "StartsWith", values: ["Live F1 Academy:"] },
    ]);
    const rule = await api.call((c) => c.rules.get({ params: { ruleId: academy } }));
    expect(rule.collectionId).toBe(collection.id);
    expect(await api.call((c) => c.rules.offer({ params: { ruleId: academy } }))).toEqual({});
    // A linked collection's conditions are its series recording's.
    expect(
      await rejection(
        api.call((c) =>
          c.collections.update({
            params: { collectionId: collection.id },
            payload: { matcher: { channels: [], title: [], categories: ["Sport"], weekdays: [] } },
          }),
        ),
      ),
    ).toMatchObject({ _tag: "Conflict", code: "followsRule" });
    await api.call((c) => c.rules.ungroup({ params: { ruleId: academy } }));
    const back = await api.call((c) => c.rules.get({ params: { ruleId: academy } }));
    expect(back.collectionId).toBeUndefined();
    expect(back.offerDeclined).toBe(false);
    const declined = await api.call((c) => c.rules.declineOffer({ params: { ruleId: academy } }));
    expect(declined.offerDeclined).toBe(true);
  });

  it("unlinks a collection and keeps its conditions", async () => {
    const { api } = setup();
    const academy = RuleId.make("live-f1-academy");
    const linked = await api.call((c) =>
      c.rules.group({ params: { ruleId: academy }, payload: { name: "F1 Academy" } }),
    );
    const own = await api.call((c) =>
      c.collections.unlink({ params: { collectionId: linked.id } }),
    );
    expect(own.follows).toBeUndefined();
    expect(own.matcher).toEqual(linked.matcher);
  });

  it("deletes a collection; its series recording keeps recording and is not offered it again", async () => {
    const { api, server } = setup();
    const academy = RuleId.make("live-f1-academy");
    const linked = await api.call((c) =>
      c.rules.group({ params: { ruleId: academy }, payload: { name: "F1 Academy" } }),
    );
    await api.call((c) => c.collections.remove({ params: { collectionId: linked.id } }));
    const collections = await api.call((c) => c.collections.list());
    expect(collections.some((collection) => collection.id === linked.id)).toBe(false);
    const rule = server.data.rules.find((candidate) => candidate.id === academy);
    expect(rule?.collectionId).toBeUndefined();
    expect(rule?.offerDeclined).toBe(true);
  });

  it("keeps a series recording's skipRepeats when an older client leaves it out", async () => {
    const { api } = setup();
    const tatort = RuleId.make("tatort");
    await api.call((c) =>
      c.rules.update({ params: { ruleId: tatort }, payload: { skipRepeats: false } }),
    );
    const renamed = await api.call((c) =>
      c.rules.update({ params: { ruleId: tatort }, payload: { name: "Tatort Sundays" } }),
    );
    expect(renamed.skipRepeats).toBe(false);
  });

  it("counts and forgets a series recording's history for its owner", async () => {
    const { api } = setup();
    const tatort = RuleId.make("tatort");
    await api.call((c) =>
      c.profiles.switch({ params: { userId: UserId.make("kim") }, payload: { secret: mockPin } }),
    );
    expect(await api.call((c) => c.rules.history({ params: { ruleId: tatort } }))).toEqual({
      count: 3,
    });
    await api.call((c) => c.rules.forgetHistory({ params: { ruleId: tatort } }));
    expect(await api.call((c) => c.rules.history({ params: { ruleId: tatort } }))).toEqual({
      count: 0,
    });
  });

  it("writes history when a good episode is deleted, unless asked to record it again", async () => {
    const { api, server } = setup();
    const before = server.data.history.length;
    await api.call((c) =>
      c.recordings.remove({
        params: { recordingId: RecordingId.make("tatort-unter-woelfen") },
        query: {},
      }),
    );
    expect(server.data.history).toHaveLength(before + 1);
    expect(server.data.history.at(-1)).toMatchObject({ showKey: "tatort", episode: 1247 });
  });

  it("takes back a series recording within the undo window", async () => {
    const { api, server } = setup();
    const created = await api.call((c) =>
      c.rules.create({
        payload: {
          name: "Darts:",
          enabled: true,
          matcher: {
            channels: [ChannelId.make("sky-sport-1")],
            title: [{ _tag: "StartsWith", values: ["Golf:"] }],
            categories: [],
            weekdays: [],
          },
          padding: { beforeMinutes: 0, afterMinutes: 0 },
          retention: { _tag: "KeepAll" },
          skipRepeats: true,
        },
      }),
    );
    expect(server.data.recordings.some((entry) => entry.ruleId === created.id)).toBe(true);
    await api.call((c) =>
      c.rules.remove({ params: { ruleId: created.id }, query: { undo: true } }),
    );
    expect(server.data.rules.some((rule) => rule.id === created.id)).toBe(false);
    expect(server.data.recordings.some((entry) => entry.ruleId === created.id)).toBe(false);
  });
});
