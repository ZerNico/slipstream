# @slipstream/server

The Slipstream server: an Effect 4.1 Node application that implements the `@slipstream/api`
HttpApi, keeps its state in SQLite, refreshes sources, runs `@slipstream/recorder` (shared ffmpeg
captures, recording scheduler, retention, disk guard), serves HLS from the segment index, serves
the built web app and announces itself on the local network.

## Running

```sh
pnpm --filter @slipstream/server dev     # against a local fake source, state in .data/dev
pnpm --filter @slipstream/server start   # production, configured by environment variables
pnpm --filter @slipstream/server test
pnpm --filter @slipstream/server db:generate   # after changing src/db/schema.ts
```

`dev` starts `@slipstream/fake-source` on port 8090 and the server on 8080, and adds the fake
source once. There are no default credentials: open the web UI (or `POST /api/auth/setup`) to
create the admin account.

## Configuration

Bootstrap settings come from the environment; everything else is configured in the UI.

| Variable                         | Default                | Meaning                                                                    |
| -------------------------------- | ---------------------- | -------------------------------------------------------------------------- |
| `SLIPSTREAM_PORT`                | `8080`                 | HTTP port                                                                  |
| `SLIPSTREAM_HOST`                | `0.0.0.0`              | Address to bind                                                            |
| `SLIPSTREAM_CONFIG_DIR`          | `.data/config`         | SQLite database and its pre-migration backups. Must be a real disk path    |
| `SLIPSTREAM_DATA_DIR`            | `.data/data`           | Segment store                                                              |
| `SLIPSTREAM_PUBLIC_URL`          | (unset)                | How people reach the server, e.g. `https://tv.example.com`. Links, cookies |
| `SLIPSTREAM_TRUSTED_PROXIES`     | (none)                 | Comma-separated addresses or CIDR ranges whose `X-Forwarded-*` is believed |
| `SLIPSTREAM_WEB_DIR`             | (unset)                | Built web app (`apps/web/dist`), served with SPA fallback                  |
| `SLIPSTREAM_TIME_ZONE`           | the system's time zone | Household time zone for rule weekdays and dates in group paths             |
| `SLIPSTREAM_FFMPEG`              | `ffmpeg`               | ffmpeg binary for captures, the self-check and hardware detection          |
| `SLIPSTREAM_FFPROBE`             | next to ffmpeg         | ffprobe binary for stream information                                      |
| `SLIPSTREAM_FREE_SPACE_FLOOR_GB` | `20`                   | Free space the disk guard keeps: DVR windows shrink first, then retention  |
| `SLIPSTREAM_MDNS`                | `true`                 | Announce `_slipstream._tcp` (TXT `url`) on the LAN; `false` turns it off   |
| `SLIPSTREAM_STARTUP_CHECKS`      | `true`                 | Run the ffmpeg self-check and hardware encoder detection on startup        |

Do not put the database on a FUSE or network share (on Unraid: `/mnt/cache/...`, never
`/mnt/user/...`); SQLite corrupts there.

## Layout

| Path               | What                                                                       |
| ------------------ | -------------------------------------------------------------------------- |
| `src/config.ts`    | `ServerConfig`: environment variables validated with Schema                |
| `src/db/`          | Drizzle schema, the `Db` service (writer + read-only connection), migrator |
| `drizzle/`         | Generated migrations; `*_guide_search` is the hand-written FTS5 index      |
| `src/auth/`        | scrypt passwords, sessions, devices, device codes, rate limits, signing    |
| `src/http/`        | API handlers, the `Authentication` middleware (cookie + CSRF, bearer), HLS |
| `src/sources/`     | Source CRUD with write-only secrets, refresh and import, refresh schedule  |
| `src/guide/`       | Time windows, now/next, full-text search                                   |
| `src/rules/`       | Rules and their previews                                                   |
| `src/collections/` | Collections, ranking and previews                                          |
| `src/recordings/`  | Library with group paths, caller progress, one-off recordings, conflicts   |
| `src/recorder/`    | The `Recorder` service over `@slipstream/recorder`, its SQLite ports       |
| `src/household/`   | The caller's account kind and access policy (`Viewer`), shared checks      |
| `src/profiles/`    | Household profiles and accounts, PINs, switching a browser or household TV |
| `src/guests/`      | Guests and their invite links                                              |
| `src/settings/`    | Recording settings (default extra time, artwork order), playback settings  |
| `src/programmes/`  | Per-profile record options for a programme                                 |
| `src/artwork/`     | The artwork resolver over guide images and frames, and the frame grabber   |
| `src/streams/`     | Each source's stream budget and who uses it                                |
| `src/system/`      | System info, hardware encoder detection, mDNS announcement                 |
| `src/hls/`         | Playlists from the segment index, byte ranges                              |
| `src/playback/`    | Playback sessions (signed playlist URLs) and resume positions              |

## Database

SQLite in WAL mode via Drizzle (`drizzle-orm/effect-sqlite-node` on `@effect/sql-sqlite-node`,
which uses `node:sqlite`). One writer connection serialises all writes behind its semaphore
(`BEGIN IMMEDIATE` transactions); reads use a second, read-only connection. `busy_timeout` is
5 seconds. On startup pending migrations are applied, after copying the database with
`VACUUM INTO` to `$SLIPSTREAM_CONFIG_DIR/backups/`.

Times are epoch milliseconds. Programmes are stored per XMLTV channel id and reach channels
through `channels.guide_channel_id`, so remapping a channel needs no re-import.

## Auth

- First-run setup creates the admin; there are no default credentials.
- Browsers get an HTTP-only `slipstream_session` cookie (SameSite=Lax, Secure behind https).
  State-changing requests authenticated by that cookie must send `x-csrf-token` with the value of
  the readable `slipstream_csrf` cookie.
- Apps send `Authorization: Bearer <device token>`; tokens come from a password sign-in with a
  `device`, or from the device-code flow. Device tokens are revocable and extended on use.
- Only SHA-256 hashes of session and device secrets are stored.
- HLS URLs carry a signed `token` valid for six hours and one playlist or capture.
- Household profiles added in the app have no password; people switch to them
  (`POST /api/profiles/{id}/switch`) with their four-digit PIN when one is set, or for an admin
  profile without a PIN with its password. Wrong PINs count against the sign-in rate limit. A
  browser gets a new session; a household TV (approved with `household: true`) keeps its token,
  now acts as the profile, and never acts with admin rights.
- Guests accept an invite link (`/invite?token=…`; the token is stored as its SHA-256 plus a
  sealed copy for copying the link again) and get their own account. Their access policy
  (channels, collections, may record, stream limit) is enforced in the services: guide, channels,
  library, artwork, playback and rules only show and accept what it allows. The same policy can
  restrict a household profile (Kids).

## Artwork and streams

Every library entry and `GET /api/artwork` resolve artwork with the domain's `resolveArtwork`
and the household's order: the guide image, a frame from the recording, else generated
artwork. A background grabber looks every 30 seconds for recordings that have captured past
their frame moment (10 minutes into the programme, the middle of short ones), and takes the
first picture that is not black from a one-minute window with ffmpeg. A window of only black
counts as a failed attempt; the next one looks two minutes later, and after three the recording
keeps its other artwork. Frames live in `$SLIPSTREAM_DATA_DIR/frames/<recordingId>.jpg` and are
removed with their recording.

`GET /api/streams` counts one stream per running channel capture: with a recording on it, it
counts as recording, otherwise as watching. A new live session is refused with
`StreamLimitReached` when the profile reached its own limit, or when no source of the channel
has a stream left for watching (`max - max(kept for recordings, recording)`); joining a capture
that already runs is always free.

## The recorder

Services talk to the `Recorder` service (`src/recorder/engine.ts`), built on
`@slipstream/recorder`: one shared ffmpeg capture per channel (recordings and
live viewers lease it), the scheduler (rules planned eight days ahead, start and stop at padded
times, outcome judged from the segment index), the retention sweeper and the disk guard.
`src/recorder/repos.ts` adapts the recorder's ports to SQLite: recordings with owners and
labels, the segment index (the first segment of a capture opens its `captures` row), the guide
with a change stream, rules, the channel line-up with opened source secrets, and retention
policies (the placed collection's policy, else the rule's; `KeepNewestEvents` uses the layout's
event part). Recorder events become `capture_logs` rows, source health and SSE events. Captures
live under `$SLIPSTREAM_DATA_DIR/captures`.

The recorder reports capture states in the domain's words (`starting`, `running`,
`reconnecting`, `stopped`, `failed`); `failed` is a channel left without a stream, which waits for
one and opens a new run when it frees.

Stopping a running recording answers immediately and the recording settles (completed,
incomplete or failed) a few seconds later, once the last segment has landed; clients see a
`RecordingChanged` event.

Playback sessions run `decideTranscode` over ffprobe's view of a stored segment. Transcoding is
not implemented yet: a session that would need a conversion still serves the original as
`direct`.

## Source secrets

Source configs and secret headers are sealed with AES-256-GCM before they reach SQLite. The key
is `$SLIPSTREAM_CONFIG_DIR/secret.key` (created on first start, mode 0600); back it up with the
database, a restored database is useless without it. Responses only ever carry `SourceView`.
