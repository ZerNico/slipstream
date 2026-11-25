import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { CurrentUser, SlipstreamApi } from "@slipstream/api";
import { type MockContext, notFound } from "./context.ts";
import { mockTimeZone } from "./fixtures.ts";
import { profileOf } from "./household.ts";
import {
  canCreateCollections,
  conflictRepeatAiring,
  epochMs,
  recordingOfProgramme,
  recordOptionsFor,
} from "@slipstream/domain";
import { currentPlan, planningWindow, repeatsFor } from "./series.ts";

/**
 * The mock's `programmes` group (SPEC 7.7, 7.8): the record options for one programme, worked
 * out with the same domain functions the server uses (default extra time, Goes to, Automatic's
 * group, whether the caller already records it, and from the household plan the episode
 * context and "Record the repeat instead").
 */
export const programmesGroup = (ctx: MockContext) => {
  const { data } = ctx;
  const state = data.household;
  return HttpApiBuilder.group(SlipstreamApi, "programmes", (handlers) =>
    handlers.handle("recordOptions", ({ params }) =>
      Effect.gen(function* () {
        const me = yield* CurrentUser;
        const programme = data.programmes.find((candidate) => candidate.id === params.programmeId);
        if (programme === undefined) return yield* notFound("programme", params.programmeId);
        const profile = profileOf(state, me);
        const at = Date.now();
        const repeat = repeatsFor(
          data,
          me,
          epochMs(programme.start),
          epochMs(programme.end),
          at,
        ).find((candidate) => candidate.programmeId === programme.id);
        const programmes = planningWindow(data, at);
        const plan = { ...currentPlan(data, at, programmes), programmes };
        const recorded = recordingOfProgramme(programme, data.recordings, at);
        return recordOptionsFor({
          programme,
          channelName: data.channels.find((channel) => channel.id === programme.channelId)?.name,
          recordings: data.recordings,
          now: at,
          collections: data.collections,
          access: profile.access,
          mayCreateCollections: canCreateCollections(me),
          extraTime: state.recording.extraTime,
          timeZone: mockTimeZone,
          repeat,
          episodes: plan.context,
          repeatAiring: conflictRepeatAiring(programme, recorded, me.id, plan),
        });
      }),
    ),
  );
};

/**
 * The mock's `artwork` group: no guide images or grabbed frames, so every picture is generated
 * on the client from the entry itself and the resolver has nothing to add.
 */
export const artworkGroup = () =>
  HttpApiBuilder.group(SlipstreamApi, "artwork", (handlers) =>
    handlers
      .handle("resolve", () => Effect.succeed([]))
      .handle("frame", ({ params }) => notFound("frame", params.recordingId)),
  );
