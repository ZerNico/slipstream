/**
 * Per-profile answers about one guide entry: what the programme sheet's record section needs
 * (SPEC 7.7, 7.8), composed by the domain's `recordOptionsFor`. The default extra time comes from
 * the same `defaultExtraTime` the server applies when the recording is created, so the hint and
 * the recording always agree.
 */
import { asc, eq } from "drizzle-orm";
import { Clock, Context, Effect, Layer } from "effect";
import {
  conflictRepeatAiring,
  recordingOfProgramme,
  recordOptionsFor,
  type User,
  UserId,
} from "@slipstream/domain";
import { ServerConfig } from "../config.ts";
import { Db } from "../db/client.ts";
import { channels, users } from "../db/schema.ts";
import { Guide } from "../guide/service.ts";
import { loadViewer, seesRecording } from "../household/viewer.ts";
import { Planning } from "../planning/service.ts";
import { loadCollections } from "../recordings/store.ts";
import { Settings } from "../settings/service.ts";

const makeProgrammes = Effect.gen(function* () {
  const { read } = yield* Db;
  const guide = yield* Guide;
  const settings = yield* Settings;
  const config = yield* ServerConfig;
  const planning = yield* Planning;

  const recordOptions = Effect.fn("Programmes.recordOptions")(function* (
    actor: User,
    programmeId: string,
  ) {
    const programme = yield* guide.programmeFor(actor, programmeId);
    const viewer = yield* loadViewer(read, actor);
    const { extraTime } = yield* settings.recording;
    const collectionList = yield* loadCollections(read);
    const [channel] = yield* read
      .select({ name: channels.name })
      .from(channels)
      .where(eq(channels.id, programme.channelId))
      .pipe(Effect.orDie);
    const now = yield* Clock.currentTimeMillis;
    // The household plan: what identifying the episode needs (`episodes`), and for an airing
    // the sources cannot serve, the later airing the plan would pick ("Record the repeat
    // instead"). Hidden recordings (replaced, or deleted while their repeat is looked for) are
    // gone for the sheet.
    const plan = yield* planning.inputs;
    const existing = plan.recordings.filter((recording) => recording.hiddenAt === undefined);
    // Whether the caller may see where the recording of this airing goes.
    const shown = recordingOfProgramme(programme, existing, now);
    const visible =
      shown === undefined ? true : yield* seesRecording(read, viewer, shown, config.timeZone);
    // "Already being recorded for the household · Ask Jonas (admin) to share it".
    const [admin] = visible
      ? []
      : yield* read
          .select({ id: users.id })
          .from(users)
          .where(eq(users.role, "admin"))
          .orderBy(asc(users.createdAt))
          .limit(1)
          .pipe(Effect.orDie);
    return recordOptionsFor({
      programme,
      channelName: channel?.name,
      recordings: existing,
      now,
      collections: collectionList,
      access: viewer.access,
      mayCreateCollections: actor.role === "admin",
      extraTime,
      timeZone: config.timeZone,
      sees: () => visible,
      householdAdminId: admin === undefined ? undefined : UserId.make(admin.id),
      // `Owned` or `Repeat` (§3.1): from the planner's guide repeats, whose `of` is always a
      // copy the caller may see.
      repeat: yield* planning.repeatFor(actor, programme.id),
      episodes: plan.context,
      repeatAiring: conflictRepeatAiring(programme, shown, actor.id, plan),
    });
  });

  return { recordOptions };
});

/** Per-profile programme answers. */
export class Programmes extends Context.Service<
  Programmes,
  Effect.Success<typeof makeProgrammes>
>()("@slipstream/server/Programmes") {
  static readonly layer = Layer.effect(Programmes, makeProgrammes);
}
