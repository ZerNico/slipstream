// @vitest-environment happy-dom
import type { QueryClient } from "@tanstack/react-query";
import { DateTime } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  ChannelId,
  CollectionId,
  DeviceId,
  RecordingId,
  RuleId,
  SourceId,
  UserId,
} from "@slipstream/domain";
import { renderWithApi, type Rendered } from "~/test/render.tsx";
import { mockPassword } from "./mock/server.ts";
import * as settingsWrites from "~/modules/settings/queries.ts";
import * as apiWrites from "./mutations.ts";
import { keys } from "./queries.ts";

/** Every write hook: the shared ones and the settings screens' (profiles, guests, PINs). */
const mutations = { ...apiWrites, ...settingsWrites };

type Hooks = { readonly [K in keyof typeof mutations]: ReturnType<(typeof mutations)[K]> };

let rendered: Rendered | undefined;
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
});

/** Mounts every mutation hook against a fresh mock server and hands them to the test. */
const withMutations = async (options: { setupRequired?: boolean } = {}) => {
  let hooks: Hooks | undefined;
  function Capture() {
    hooks = Object.fromEntries(
      Object.entries(mutations).map(([name, hook]) => [name, hook()]),
    ) as Hooks;
    return null;
  }
  rendered = await renderWithApi(<Capture />, options);
  const { server, client } = rendered;
  const run = async <T,>(pick: (all: Hooks) => Promise<T>): Promise<T> => {
    if (!hooks) throw new Error("hooks did not mount");
    return pick(hooks);
  };
  return { run, server, client };
};

const removedFrom = (client: QueryClient, key: readonly unknown[]) =>
  client.getQueryState(key)?.isInvalidated ?? true;

describe("every write the web makes, against the mock server", () => {
  it("sets up a fresh server and signs the admin in", async () => {
    const { run, client } = await withMutations({ setupRequired: true });
    const result = await run((m) =>
      m.useSetup.mutateAsync({
        username: "jonas",
        displayName: "Jonas",
        password: "a long password",
      }),
    );
    expect(result.user.role).toBe("admin");
    expect(client.getQueryData(keys.setup)).toEqual({ required: false });
  });

  it("signs in and out", async () => {
    const { run, client } = await withMutations();
    const login = await run((m) =>
      m.useLogin.mutateAsync({ username: "alex", password: mockPassword }),
    );
    expect(client.getQueryData(keys.me)).toEqual(login.user);
    await run((m) => m.useLogout.mutateAsync());
    expect(client.getQueryData(keys.me)).toBeUndefined();
  });

  it("approves a TV's code and revokes a device", async () => {
    const { run, server } = await withMutations();
    await run((m) => m.useApproveDevice.mutateAsync({ userCode: "QK74RM", approve: true }));
    await run((m) => m.useRevokeDevice.mutateAsync(DeviceId.make("pixel")));
    expect(server.data.devices.find((device) => device.id === "pixel")).toBeUndefined();
  });

  it("adds, changes and removes a profile, and every profile view catches up", async () => {
    const { run, server, client } = await withMutations();
    client.setQueryData(keys.profiles, []);
    const nora = await run((m) =>
      m.useCreateProfile.mutateAsync({
        displayName: "Nora",
        avatarTone: "teal",
        login: { username: "nora", password: "long enough!" },
      }),
    );
    expect(removedFrom(client, keys.profiles)).toBe(true);
    client.setQueryData(keys.profiles, []);
    await run((m) =>
      m.useUpdateProfile.mutateAsync({ id: nora.id, update: { displayName: "Nora B." } }),
    );
    expect(removedFrom(client, keys.profiles)).toBe(true);
    expect(server.data.users.find((user) => user.id === nora.id)?.displayName).toBe("Nora B.");
    client.setQueryData(keys.profiles, []);
    await run((m) => m.useRemoveProfile.mutateAsync(UserId.make(nora.id)));
    expect(removedFrom(client, keys.profiles)).toBe(true);
    expect(server.data.users.some((user) => user.id === nora.id)).toBe(false);
  });

  it("protects, stops and deletes recordings", async () => {
    const { run, server } = await withMutations();
    const protectedEntry = await run((m) =>
      m.useUpdateRecording.mutateAsync({
        id: RecordingId.make("presse-qualifying"),
        update: { protected: true },
      }),
    );
    expect(protectedEntry.protected).toBe(true);
    await run((m) => m.useStopRecording.mutateAsync(RecordingId.make("rennen-las-vegas")));
    expect(server.data.recordings.find((entry) => entry.id === "rennen-las-vegas")?.state).not.toBe(
      "recording",
    );
    await run((m) => m.useDeleteRecording.mutateAsync({ id: RecordingId.make("rennen-kompakt") }));
    expect(server.data.recordings.some((entry) => entry.id === "rennen-kompakt")).toBe(false);
  });

  it("creates, renames and deletes a rule", async () => {
    const { run, server } = await withMutations();
    const template = server.data.rules.find((rule) => rule.id === "tatort");
    if (!template) throw new Error("fixture rule missing");
    const { id: _id, ownerId: _owner, createdAt: _created, ...input } = template;
    const created = await run((m) =>
      m.useSaveRule.mutateAsync({ rule: { ...input, name: "Tatort again" } }),
    );
    const renamed = await run((m) =>
      m.useSaveRule.mutateAsync({ id: created.id, update: { name: "Tatort Sundays" } }),
    );
    expect(renamed.name).toBe("Tatort Sundays");
    await run((m) => m.useDeleteRule.mutateAsync({ id: RuleId.make(created.id) }));
    expect(server.data.rules.some((rule) => rule.id === created.id)).toBe(false);
  });

  it("groups a series recording, undoes it, declines the offer and forgets history", async () => {
    const { run, server, client } = await withMutations();
    const academy = RuleId.make("live-f1-academy");
    client.setQueryData(keys.guideRepeats(0, 1), []);
    const linked = await run((m) =>
      m.useCreateSeriesCollection.mutateAsync({
        ruleId: academy,
        request: { name: "F1 Academy" },
      }),
    );
    expect(linked.follows?.ruleId).toBe(academy);
    expect(client.getQueryState(keys.guideRepeats(0, 1))?.isInvalidated).toBe(true);
    await run((m) => m.useUndoSeriesCollection.mutateAsync(academy));
    expect(server.data.collections.some((collection) => collection.id === linked.id)).toBe(false);
    const again = await run((m) =>
      m.useCreateSeriesCollection.mutateAsync({
        ruleId: academy,
        request: { name: "F1 Academy" },
      }),
    );
    const own = await run((m) => m.useUnlinkCollection.mutateAsync(again.id));
    expect(own.follows).toBeUndefined();
    expect(own.matcher).toEqual(again.matcher);
    const declined = await run((m) => m.useDeclineOffer.mutateAsync(academy));
    expect(declined.offerDeclined).toBe(true);
    expect(await run((m) => m.useForgetHistory.mutateAsync(RuleId.make("tatort")))).toEqual({
      count: 0,
    });
  });

  it("deletes with the history and rerun choices, keeps an original and dismisses a notice", async () => {
    const { run, server } = await withMutations();
    const before = server.data.history.length;
    await run((m) =>
      m.useDeleteRecording.mutateAsync({
        id: RecordingId.make("tatort-unter-woelfen"),
        history: "skip",
      }),
    );
    expect(server.data.history).toHaveLength(before);
    await run((m) =>
      m.useDeleteRecording.mutateAsync({
        id: RecordingId.make("darts-halbfinale-failed"),
        rerun: "stop",
      }),
    );
    expect(server.data.recordings.some((entry) => entry.id === "darts-halbfinale-failed")).toBe(
      false,
    );
    // A repeat that replaced the race: keeping the original shows it again.
    server.data.recordings = server.data.recordings.map((entry) =>
      entry.id === "rennen-1"
        ? { ...entry, replacedById: RecordingId.make("rennen-2"), hiddenAt: entry.end }
        : entry.id === "rennen-2"
          ? { ...entry, replacesId: RecordingId.make("rennen-1") }
          : entry,
    );
    const original = await run((m) => m.useKeepOriginal.mutateAsync(RecordingId.make("rennen-2")));
    expect(original).toMatchObject({ id: "rennen-1", rerunOutcome: "kept" });
    expect(original.hiddenAt).toBeUndefined();
  });

  it("adds, tests, changes and refreshes sources", async () => {
    const { run, server } = await withMutations();
    const existing = server.data.sources.find((source) => source.id === "tvproxy");
    if (!existing) throw new Error("fixture source missing");
    const { id: _id, health: _health, lastRefreshAt: _refreshed, ...input } = existing;
    await run((m) => m.useTestSource.mutateAsync({ ...input, name: "Second provider" }));
    const created = await run((m) =>
      m.useCreateSource.mutateAsync({ ...input, name: "Second provider" }),
    );
    await run((m) => m.useUpdateSource.mutateAsync({ id: created.id, update: { enabled: false } }));
    expect(server.data.sources.find((source) => source.id === created.id)?.enabled).toBe(false);
    await run((m) => m.useRefreshSource.mutateAsync(SourceId.make("tvproxy")));
  });

  it("changes a channel", async () => {
    const { run, server } = await withMutations();
    const [channel] = server.data.channels;
    if (!channel) throw new Error("no fixture channel");
    await run((m) =>
      m.useUpdateChannel.mutateAsync({
        id: ChannelId.make(channel.id),
        update: { favourite: !channel.favourite },
      }),
    );
    expect(server.data.channels.find((candidate) => candidate.id === channel.id)?.favourite).toBe(
      !channel.favourite,
    );
  });

  it("creates a collection and moves similar recordings into one", async () => {
    const { run, server } = await withMutations();
    const formel = server.data.collections.find((collection) => collection.id === "formel-1");
    if (!formel) throw new Error("fixture collection missing");
    const { id: _id, ...input } = formel;
    const created = await run((m) =>
      m.useCreateCollection.mutateAsync({ ...input, name: "Snooker" }),
    );
    expect(server.data.collections.some((collection) => collection.id === created.id)).toBe(true);
    await run((m) =>
      m.useMoveSimilar.mutateAsync({
        collectionId: CollectionId.make("formel-1"),
        recordingId: RecordingId.make("presse-qualifying"),
      }),
    );
  });

  it("records a scheduled programme, saves progress and playback settings", async () => {
    const { run, server, client } = await withMutations();
    const programme = server.data.programmes.find(
      (candidate) => DateTime.toEpochMillis(candidate.start) > Date.now(),
    );
    if (programme) {
      await run((m) =>
        m.useCreateRecording.mutateAsync({ _tag: "Programme", programmeId: programme.id }),
      );
    }
    const state = await run((m) =>
      m.useSaveProgress.mutateAsync({
        target: { _tag: "Recording", recordingId: RecordingId.make("presse-qualifying") },
        positionMillis: 60_000,
        watched: false,
      }),
    );
    expect(state.positionMillis).toBe(60_000);
    expect(removedFrom(client, keys.continueWatching)).toBe(true);
    const saved = await run((m) =>
      m.useSavePlaybackSettings.mutateAsync({
        ...server.data.playbackSettings,
        pictureConversions: "3",
      }),
    );
    expect(saved.pictureConversions).toBe("3");
  });
});
