import { epochMs, type RecordingId } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { Effect } from "effect";
import type { ShowToast } from "../ui/toast.ts";
import { Api } from "./client.ts";

/**
 * Says that a repeat replaced a damaged recording (`RecordingReplaced`, recording model §3.7),
 * while the app is open: "Tatort replaced by the repeat from Wed 25". Reads the repeat for its
 * title and day; when that fails (the profile cannot see it, or the network dropped) it says
 * nothing, the library refreshes either way.
 */
export const announceReplaced = (
  repeatId: RecordingId,
  show: ShowToast,
): Effect.Effect<void, never, Api> =>
  Effect.flatMap(Api, (api) => api.recordings.get({ params: { recordingId: repeatId } })).pipe(
    Effect.tap((repeat) =>
      Effect.sync(() =>
        show({
          text: m.record_replaced({
            title: repeat.title,
            start: new Date(epochMs(repeat.start)),
          }),
        }),
      ),
    ),
    Effect.ignore,
  );
