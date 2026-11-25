# @slipstream/app

One Expo app (SDK 58, react-native-tvos 0.88) for Android phones and Android TV. `Platform.isTV`
picks the layout; screens, data and logic are shared.

## Run and build

```sh
source scripts/dev-env.sh          # Node 26 + pnpm 12
source scripts/android-env.sh      # JDK 17 + Android SDK
cd apps/app
pnpm prebuild                       # EXPO_TV=1 expo prebuild --platform android (android/ is gitignored)
cd android && ./gradlew assembleDebug
# APK: apps/app/android/app/build/outputs/apk/debug/app-debug.apk
```

`pnpm test` runs the plain TypeScript modules (API client, SSE parser, sign-in flow, guide data,
record options, player state machine) under Vitest; screens need a device or emulator.

## How it talks to the server

- **API**: `effect/http-api`'s `HttpApiClient` over `fetch`, built from `@slipstream/api`
  (`src/api/client.ts`). Each server and profile gets its own `ManagedRuntime`; TanStack Query
  runs effects on it and cancels them through the query's abort signal (`src/api/queries.ts`).
- **Live updates**: `GET /api/events` as server-sent events. React Native's fetch cannot stream a
  body, so `src/api/xhr-transport.ts` reads it through XMLHttpRequest progress events,
  `src/api/sse.ts` parses it, and `src/api/events.ts` reconnects with jittered backoff and marks
  the affected queries stale.
- **Discovery**: mDNS/DNS-SD with `react-native-zeroconf` (Android NSD), service type
  `_slipstream._tcp` in `local.`. TXT keys read: `url` (public base URL, preferred) and `path`
  (base path behind a proxy). Manual address entry is always offered and is checked against
  `GET /api/health` before it is saved.
- **Sign-in**: device code (RFC 8628 pattern) with a QR code of `verificationUrl` and the short
  code, polling at the server's interval, slowing down on `slowDown`, renewing expired codes.
  Username and password is the fallback. Tokens live in `expo-secure-store`.
- **Approving a TV from the phone**: the TV's QR code holds `https://<server>/link?code=QK74RM`
  (`deviceLinkUrl`). The app's `/link` route (`src/approve/`) is the "Approve TV sign-in" screen:
  it looks the code up (`GET /api/auth/device-code/{userCode}`) to name the device, offers admins
  every household profile (`GET /api/profiles`, household profile preselected) and answers
  with `approveDeviceCode({ userCode, approve, userId? })`. Settings has "Sign in a TV" to type a
  code. A link that arrives before anyone is signed in on the phone is kept until sign-in ends.
- **Opening those links in the app**: `slipstream://link?code=…` always opens the app (scheme in
  `app.json`), so the web approve page can hand off to it. Servers have their own host names, so
  App Links for `https://<server>/link` are opt-in per build: `SLIPSTREAM_LINK_HOSTS=tv.example.com
  pnpm prebuild` adds verified intent filters (`plugins/with-device-link.cjs`); they verify against
  the server's `/.well-known/assetlinks.json`. Without either, the QR code opens the web page.
- **Profiles**: every profile signed in on a device is kept; with more than one, "Who's
  watching?" opens on launch (last used first). The picker reads `GET /api/profiles` with
  the profile used last: names and roles follow the server, deleted accounts leave the device, and
  when an admin is signed in, household profiles not on this TV yet appear and start a sign-in.
- **Live events**: the server sends `Connected` first on every connection; the app then marks
  everything live as stale, since nothing reported what changed while the stream was down.
- **Recordings (TV)**: the rail's Recordings entry opens the library: what is recording now, then
  a shelf per collection or show. Every entry carries the viewer's `watched` and `positionMillis`,
  so cards show the watched fill, OK resumes, and "Unwatched" filters locally.
- **Playback**: `POST /api/playback/sessions` returns a signed `playlistUrl`; react-native-video
  (Media3) plays it. The session is ended when the player closes.

## Remote keys on Android TV

react-native-tvos 0.88 delivers arrows, OK (and long-press OK), Back, play/pause, rewind,
fast-forward and CH +/- through `useTVEventHandler`, but **not the digit keys 0 to 9**. The
config plugin `plugins/with-digit-keys.cjs` adds a `dispatchKeyEvent` override to
`MainActivity.kt` that emits a `slipstreamDigit` device event for `KEYCODE_0..KEYCODE_9`
(`src/tv/digit-keys.ts` listens; the guide turns digits into a channel jump). Digits are only
consumed while React Native is running and no text field has focus. Remotes without digits (the
Shield's, most Google TV remotes) simply never send them.

## Brand assets

`scripts/rasterise-brand.ts` turns the SVGs in `docs/design/brand` into the PNGs Android needs
(launcher icon, adaptive icon foreground, background and monochrome layers, the TV banner and the
splash mark) in `assets/brand/`. Run `pnpm brand` after the brand changes; the PNGs are committed.

## Words and colours

Every word comes from `@slipstream/i18n` (`m.*`); the app's own keys (`guide_key_*`,
`record_*`, `signin_*` and so on) live in its `messages/app` part. Colours, radii and motion come
from `@slipstream/design-tokens/native` (`src/theme/`). API types come from `@slipstream/api`'s
type aliases (`import type { RecordingEntry } from "@slipstream/api"`).
