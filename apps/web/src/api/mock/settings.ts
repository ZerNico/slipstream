import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { InvalidInput, NotFound, SlipstreamApi } from "@slipstream/api";
import { extraTimeDefaultsProblems } from "@slipstream/domain";
import { type MockContext, requireAdmin } from "./context.ts";

/**
 * The mock's `settings` group (SPEC 7.7, PLAN 6.11): the household's recording defaults and the
 * playback and conversion settings. Everyone reads them; only admins save them.
 */
export const settingsGroup = (ctx: MockContext) => {
  const { data } = ctx;
  const state = data.household;
  return HttpApiBuilder.group(SlipstreamApi, "settings", (handlers) =>
    handlers
      .handle("recording", () => Effect.sync(() => state.recording))
      .handle("saveRecording", ({ payload }) =>
        Effect.gen(function* () {
          yield* requireAdmin;
          const problems = extraTimeDefaultsProblems(payload.extraTime).map((problem) => ({
            path: `extraTime.overrides.${problem.index}`,
            code: problem._tag === "DuplicateChannel" ? "duplicateChannel" : "duplicateCategory",
          }));
          if (problems.length > 0) return yield* Effect.fail(new InvalidInput({ problems }));
          for (const override of payload.extraTime.overrides) {
            if (
              override._tag === "Channel" &&
              !data.channels.some((channel) => channel.id === override.channelId)
            ) {
              return yield* Effect.fail(
                new NotFound({ entity: "channel", id: override.channelId }),
              );
            }
          }
          state.recording = payload;
          return payload;
        }),
      )
      .handle("artwork", () => Effect.sync(() => ({ tmdb: state.tmdb })))
      .handle("saveArtwork", ({ payload }) =>
        Effect.gen(function* () {
          yield* requireAdmin;
          // The mock refuses the key "invalid", as TMDB would a wrong one.
          if (payload.tmdbKey === "invalid") {
            return yield* Effect.fail(
              new InvalidInput({ problems: [{ path: "tmdbKey", code: "invalidKey" }] }),
            );
          }
          state.tmdb = payload.tmdbKey !== null && payload.tmdbKey.trim() !== "";
          return { tmdb: state.tmdb };
        }),
      )
      .handle("playback", () => Effect.sync(() => data.playbackSettings))
      .handle("savePlayback", ({ payload }) =>
        Effect.gen(function* () {
          yield* requireAdmin;
          data.playbackSettings = payload;
          return payload;
        }),
      ),
  );
};
