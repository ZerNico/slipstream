# Architecture

How Slipstream is built and why. For what each package owns and the rules that keep them apart,
see [AGENTS.md](../AGENTS.md); for the recording behaviour in detail (series recordings,
collections, skipping repeats, repeat fallback), see
[design/recording-model.md](design/recording-model.md).

## Goals

- **Reliable rule-based recording.** Recording every airing of something (every live F1 session,
  say) must work unattended, with generous extra time, and must never record the wrong programme
  because of a fuzzy title match.
- **Join late, watch from the start.** Any recording can be watched while it is still running,
  from its start, with a jump to live. Live TV can be paused and rewound.
- **Copy first, convert only when needed, automatically.** Recordings are the original stream.
  When something has to be converted (a codec the device cannot play, too little bandwidth), it
  happens at playback, decided by the server, with hardware acceleration detected automatically.
  Nobody maintains ffmpeg arguments.
- **Its own clients.** Web, Android phone and Android TV, with no dependency on Plex or Jellyfin.
- **Built for other people to run.** Nothing about a particular provider, sport or server is
  hard-coded; those are a source and an example rule. Good defaults, plain-language
  explanations, and failures that say what happened and what to do.
- **Not fragile.** Pinned ffmpeg, a startup self-check against a test stream, and no
  `:latest`-style surprises.

### Non-goals

- Managing a VOD or film library: Plex and Jellyfin do that well.
- iOS and Apple TV for now (Expo and react-native-tvos would allow them later).
- Postgres: SQLite is enough for the load and keeps setup to one container.

## Overview

```
            ┌──────────── Sources ────────────┐
            │       M3U playlist + XMLTV      │   input adapters (packages/sources)
            └────────┬─────────────────┬──────┘
                 streams          guide data
                     │                 │
              ┌──────▼──────┐   ┌──────▼──────┐
              │  Channels   │◄─►│    Guide    │   curated channel list, guide clean-up
              └──────┬──────┘   └──────┬──────┘
                     │                 │
       ┌─────────────▼──────────┐ ┌────▼──────────────┐
       │     Capture engine     │◄┤ Rules / scheduler │
       │ one ffmpeg per channel │ └───────────────────┘
       │ shared by all consumers│
       └─────────────┬──────────┘
                     │ segments + index
              ┌──────▼──────┐
              │Segment store│   <data>/captures/... + SQLite index
              └──────┬──────┘
                     │ playlists generated per request
       ┌─────────────▼─────────────┐
       │  HLS + API (HttpApi, SSE) │
       └────┬────────────┬─────────┘
           web     app (phone / TV)
```

One server process (`apps/server`) runs everything: the API, the scheduler, the capture engine
(`packages/recorder`) and the static web app. Clients talk to it only through the typed contract
in `packages/api` (Effect `HttpApi`, with a generated `openapi.json`) plus HLS, and get live
updates over server-sent events (`GET /api/events`).

## Everything is a time range over a segment store

This is the core idea; most features fall out of it.

- **Capturing** a channel runs ffmpeg with stream copy (`-c copy`), writing MPEG-TS segments of
  about 6 seconds. Each segment is indexed in SQLite with its wall-clock start, duration and
  capture.
- **A recording** is a channel plus a time range (the programme with extra time before and after)
  that is retained. No copy is made.
- **Watching a recording while it runs** is an HLS `EVENT` playlist over that range, generated on
  request. It grows until the range ends, then becomes a `VOD` playlist with `#EXT-X-ENDLIST`.
- **Live TV with pause and rewind** works the same way: tuning in starts or joins the channel's
  capture, and the player gets a sliding playlist with a DVR window (4 hours by default).
- **Watching a programme from its start** works for any programme whose start lies inside
  captured data, for example because the channel is being recorded or someone has been watching
  it (`/hls/range/:channel.m3u8?from=&to=`).
- **Stream drops:** ffmpeg exits, the capture reconnects with backoff, and a new run begins. The
  playlist gets `#EXT-X-DISCONTINUITY` and the gap is recorded, so the UI can say "missing 00:42
  at 13:12".
- **Retention** deletes finished recordings under each series recording's or collection's policy,
  then deletes every segment file that no remaining recording's range and no live DVR window
  covers (a viewer's, or the kept buffer of a channel nobody watches any more, see below).

HLS routes live outside the JSON API because players cannot send auth headers reliably:

| Route                                   | What                                             |
| --------------------------------------- | ------------------------------------------------ |
| `GET /hls/live/:channelId.m3u8`         | Live with DVR window (starts or joins a capture) |
| `GET /hls/recordings/:recordingId.m3u8` | `EVENT` while recording, `VOD` when done         |
| `GET /hls/range/:channelId.m3u8`        | Any captured range (watching from the start)     |
| `GET /hls/seg/:captureId/:sequence.ts`  | Segment files, with Range support                |

## Capture engine

- **At most one upstream connection per channel.** Live viewers and recordings are consumers
  that hold a lease on the channel's capture; it runs while at least one lease is held.
- **Streams in fallback order.** A channel can have several streams (from one or more sources).
  The capture picks the best one whose source has room and falls back to the next when a source
  refuses (HTTP 403/429/509, or a connection closed before the first byte) or keeps failing.
- **Stream limits with priorities.** Each source has a maximum number of concurrent streams.
  Recordings come first: a recording that finds every stream busy takes one from a channel only
  live viewers are using; live viewers never take a stream from a recording. Conflicts are shown
  when scheduling.
- **Live TV waits for its viewers.** A live viewer counts as gone after 60 s without fetching
  anything. The channel then keeps running for a while (Settings › Recording › Live TV: 10
  minutes by default, up to an hour, or until the programme on air ends, at most 4 hours), so a
  reload or a short break finds the whole rewind buffer. Such a lingering channel holds no
  consumer and gives way first: a recording, or a viewer of another channel, that finds no free
  stream takes its stream at once. Once a watched channel's capture stopped, its DVR window stays
  retained as a kept buffer (1 hour by default, up to 24 hours, never beyond the DVR window); a
  viewer coming back rewinds into it, and the live playlist shows the gap with a discontinuity
  and each stretch's own `PROGRAM-DATE-TIME`. A recording that keeps the capture running past
  the linger does not change that: the viewer's window becomes a kept buffer when the linger
  ends. A capture an admin stops by hand keeps nothing. Kept buffers live in memory, so a
  restart lets them go.
- **ffmpeg processes are scoped resources** (Effect `Scope`): always killed on interrupt or
  shutdown. Reconnects use `Schedule`.
- **Startup self-check:** the server runs the ffmpeg it finds against a generated test stream and
  reports problems on the system page instead of producing empty recordings later.
- **Probing:** ffprobe records codecs, resolution, frame rate, interlacing and audio tracks per
  capture, shown as a quality badge and used by the playback decision.
- **Disk-space guard:** below a configurable free-space floor, kept buffers go first, then live
  DVR windows shrink, then retention runs early on the oldest unprotected recordings. Running
  recordings are never cut.

The capture engine sits behind an interface, so a native segmenter could replace ffmpeg later if
it ever mattered.

## Scheduler

An in-process scheduler (no cron, no external queue) keeps the recording plan current: it matches
series recordings against the guide, re-plans when the guide or the rules change and as the
horizon moves, takes a capture lease at the programme's start minus extra time and releases it at
its end plus extra time. Duplicate guide entries and guide refreshes that re-identify a programme
do not cause double recordings. Repeat skipping and the automatic repeat fallback are described in
[design/recording-model.md](design/recording-model.md).

## Playback and transcoding

Principle: store the original, adapt on playback, decide automatically.

Clients report what they can decode when they start a playback session (web through
`MediaSource.isTypeSupported` / `MediaCapabilities`, Android through `MediaCodecList`). The server
combines that with what ffprobe saw and the requested quality, and picks the cheapest delivery
that works:

| Level      | When                                                                                       | Cost                       |
| ---------- | ------------------------------------------------------------------------------------------ | -------------------------- |
| Direct     | The device decodes everything and bandwidth is enough                                      | none                       |
| Remux      | Only the container or packaging does not fit                                               | negligible                 |
| Audio only | Video is fine, audio is not (e.g. MP2 or AC3 in a browser)                                 | low, CPU only              |
| Video      | Unsupported codec, interlaced on a device that cannot deinterlace, or not enough bandwidth | hardware encoder, else CPU |

The decision is pure logic in `packages/domain` (`decideTranscode`), shared by server and
clients. Hardware encoders (NVENC, Quick Sync, VAAPI) are detected at startup with a short test
encode per codec and rate-control mode, because `ffmpeg -encoders` only says what was compiled
in.

What each track gets, per session (the quality cap is the device's choice or the household's
default for home, away or mobile data):

| Video                                                                                                 | Audio                                                      | Delivery                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codec, profile and size decodable, not interlaced (or the device deinterlaces), under the cap         | Codec decodable or passed through (passthrough only at 1x) | Direct: the stored segments                                                                                                                                                                           |
| as above                                                                                              | Not playable, or passthrough while catching up             | Audio: video copied, the chosen track to AAC-LC stereo 48 kHz 192 kbit/s (surround downmixed)                                                                                                         |
| Unsupported codec/profile, too large, interlaced on a device that cannot deinterlace, or over the cap | Playable: copied (all tracks)                              | Video: H.264 on the detected hardware encoder in a rate-control mode that worked, else x264 `veryfast`; deinterlaced (one frame per field up to High, per frame below) and scaled to the cap's height |
| as above                                                                                              | Not playable                                               | Video and audio                                                                                                                                                                                       |

**The conversion pipeline** (`apps/server/src/transcode/`) works on the segment store like
everything else: a converting session gets a playlist named by its variant
(`/hls/live/<channel>/<variant>.m3u8`, e.g. `copy_aac-0-2-192`), with the variant in its signed
segment tokens, and each segment is converted on request with `-copyts`, so it lines up with the
original's times. Live, timeshift, ranges and recordings, seeking and many viewers all work as
for the original. Converted segments are keyed by source segment and variant, cached for ten
minutes (bounded in size, gone when their source is purged), and converted once however many
viewers ask (single flight); a job nobody waits for any more is stopped. Live conversions in use
convert each new segment as it is indexed, and a picture conversion converts the next segment
ahead. Audio is encoded on one 1024-sample frame grid across segments, warmed up by the previous
segment, so the AAC frames of neighbouring segments hand over without a gap, an overlap or a
click. At most four picture conversions (one per four cores in software) are in use at once;
over that, a session whose device plays the original picture gets it (logged), one that cannot
waits for the converter. A converted audio track is the only audio track of its stream (hls.js
plays only the first track of a muxed stream anyway); picking another language is a session
update, and another variant.

Playback sessions hand out short-lived signed playlist URLs, bound to the sign-in and to a time
window, and renewed while the session lasts.

## Domain model

The schemas live in `packages/domain`; the SQLite tables in `apps/server/src/db/schema.ts`.

| Entity                    | What                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| Source                    | An M3U playlist and XMLTV guide, refresh interval, stream limit, headers, guide clean-up             |
| Source stream             | One stream a source offers: name, URL, guide id, group, logo, when it was last seen                  |
| Channel                   | What people see: name, number, logo, guide mapping, favourite, hidden                                |
| Channel stream            | A source stream attached to a channel, with its fallback priority                                    |
| Programme                 | A guide entry: channel, start, end, title, sub-title, description, categories, episode info          |
| Capture / segment         | One upstream connection's runs, and the indexed segment files it wrote                               |
| Recording                 | A channel and a retained time range, optionally a programme; state, gaps, owners, protection         |
| Rule (series recording)   | A matcher (channels, title conditions, categories, weekdays), extra time, retention, repeat skipping |
| Collection                | An optional library group: a matcher and a layout of named title parts                               |
| User, device, session     | Accounts, devices with their own revocable tokens, sign-ins                                          |
| Playback state            | Per user and recording or programme: resume position, watched                                        |
| Stream info, capabilities | What ffprobe saw on a stream, and what a device reported it can play                                 |

Two people recording the same programme share one recording with two owners.

## Users, sign-in and access

Slipstream is meant to be exposed through a reverse proxy, so authentication is part of the core.

- **Setup:** the first start opens a wizard that creates the admin account. No default
  credentials.
- **Roles:** admins manage sources, channels, users and settings; users watch and record.
- **Profiles** share devices and switch from a profile picker, each with an optional
  4-digit PIN. A shared TV never acts with admin rights.
- **Restricted profiles and guests** have an access policy: which channels, which collections,
  whether they may record, and how many streams at once. Access is checked on where an item
  lands, so a profile limited to one collection never sees a recording from elsewhere on a
  channel it may watch. Guests are invited by link and sign in from anywhere.
- **Passwords** are hashed with scrypt; sign-in is rate limited per client address. Web sessions
  use HTTP-only cookies with CSRF protection.
- **TV sign-in** uses the device-code pattern: the TV shows a QR code and a short code, a signed-in
  phone or browser approves it, and the TV is in. Username and password remain as a fallback.
- **Discovery:** the server announces itself over mDNS / DNS-SD (`_slipstream._tcp`), so the app
  lists servers on the local network; entering an address by hand always works.
- **Devices** each get their own long-lived, revocable token. Bearer secrets are stored only as
  hashes, so a copied database cannot be used to sign in.
- **Secrets at rest:** source configurations and secret headers are sealed with AES-256-GCM using
  `secret.key` in the config directory.

## Technology choices

| Concern  | Choice                                                                                                                      | Why                                                                                                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Language | TypeScript everywhere, Node 26 running `.ts` directly                                                                       | One contract and one set of schemas shared by server, web and app. The server never touches video bytes beyond serving files; ffmpeg does the heavy lifting, so Node is plenty |
| Server   | Effect (`HttpApi`, `Scope`, `Schedule`, `Layer`)                                                                            | Supervision a long-running daemon needs: every ffmpeg process is tied to a scope, retries are declarative, services are layers                                                 |
| Database | SQLite in WAL mode via Drizzle on `node:sqlite`, FTS5 for guide search                                                      | No extra container, no native addon; one writer, parallel readers. Migrations run on startup and are forward-only, after an automatic backup                                   |
| Media    | ffmpeg and ffprobe, pinned in the image                                                                                     | Stream copy into HLS with MPEG-TS segments                                                                                                                                     |
| Web      | React SPA (Vite, TanStack Router and Query, Tailwind, shadcn on Base UI, hls.js)                                            | Built to static files and served by the server, so production is one process. No SSR: the backend is a daemon, and the Android app needs the public API anyway                 |
| App      | Expo with react-native-tvos, one app for phone and TV                                                                       | One codebase; `Platform.isTV` picks the layout. The TV guide is one focusable view with its own cursor logic (`apps/app/src/tv/guide/core`) instead of per-cell native focus   |
| Player   | hls.js on the web, react-native-video (Media3) on Android                                                                   |                                                                                                                                                                                |
| Design   | `packages/design-tokens` (one token source for web and app) and `packages/i18n` (one message catalogue, English and German) | Consistent look and words across clients                                                                                                                                       |

## Ideas not built yet

Designed or wanted, but not in the code today: Xtream Codes, HDHomeRun and single-URL sources (the schema knows them, refresh
does not), exporting recordings to `.mkv`/`.mp4` with a path template, importing existing
recording folders, a rolling buffer per channel, M3U/HDHomeRun output so Plex or Jellyfin can use
Slipstream as a tuner, OIDC sign-in, notifications, offline downloads on the phone, trickplay
thumbnails and spoiler protection.
