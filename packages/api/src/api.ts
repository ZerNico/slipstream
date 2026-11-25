import { HttpApi, OpenApi } from "effect/http-api";
import { ArtworkGroup } from "./groups/artwork.ts";
import { AuthGroup } from "./groups/auth.ts";
import { CapturesGroup } from "./groups/captures.ts";
import { ChannelsGroup } from "./groups/channels.ts";
import { CollectionsGroup } from "./groups/collections.ts";
import { DevicesGroup } from "./groups/devices.ts";
import { GuestsGroup, InvitesGroup } from "./groups/guests.ts";
import { GuideGroup } from "./groups/guide.ts";
import { PlaybackGroup } from "./groups/playback.ts";
import { ProfilesGroup } from "./groups/profiles.ts";
import { ProgrammesGroup } from "./groups/programmes.ts";
import { RecordingsGroup } from "./groups/recordings.ts";
import { RulesGroup } from "./groups/rules.ts";
import { SettingsGroup } from "./groups/settings.ts";
import { SourcesGroup } from "./groups/sources.ts";
import { StreamsGroup } from "./groups/streams.ts";
import { SystemGroup } from "./groups/system.ts";

const annotations = OpenApi.annotations({
  title: "Slipstream",
  version: "0.0.0",
  description: "Live TV that waits for you. Self-hosted live TV, recording and timeshift.",
  license: { name: "AGPL-3.0-only", url: "https://www.gnu.org/licenses/agpl-3.0.html" },
});

/**
 * The Slipstream HTTP API, every group under `/api`. The server implements it with
 * `HttpApiBuilder`; web and app call it with `HttpApiClient.make(SlipstreamApi)`, and
 * `openapi.json` documents it.
 */
export class SlipstreamApi extends HttpApi.make("slipstream")
  .add(SystemGroup)
  .add(AuthGroup)
  .add(DevicesGroup)
  .add(ProfilesGroup)
  .add(GuestsGroup)
  .add(InvitesGroup)
  .add(SourcesGroup)
  .add(ChannelsGroup)
  .add(GuideGroup)
  .add(ProgrammesGroup)
  .add(RecordingsGroup)
  .add(RulesGroup)
  .add(CollectionsGroup)
  .add(CapturesGroup)
  .add(PlaybackGroup)
  .add(StreamsGroup)
  .add(SettingsGroup)
  .add(ArtworkGroup)
  .prefix("/api")
  .annotateMerge(annotations) {}

/** The OpenAPI 3.1 document for the whole API, as committed in `openapi.json`. */
export const openApiSpec = (): OpenApi.OpenAPISpec => OpenApi.fromApi(SlipstreamApi);
