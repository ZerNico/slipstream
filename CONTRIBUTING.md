# Contributing

Read [AGENTS.md](AGENTS.md) before changing anything: it has the rules and how to verify a
change, for people and coding agents alike. [docs/architecture.md](docs/architecture.md) is the
design.

## Prerequisites

| Tool                            | Why                              | Check             |
| ------------------------------- | -------------------------------- | ----------------- |
| Node 26 (`.node-version`)       | Runs the TypeScript directly     | `pnpm run doctor` |
| pnpm 12 (`packageManager`)      | Workspace, through corepack      | `pnpm run doctor` |
| ffmpeg and ffprobe 8 or newer   | Captures, the fake source, tests | `pnpm run doctor` |
| Docker (optional)               | The image, `pnpm docker:build`   | `pnpm run doctor` |
| JDK 17, Android SDK, adb (opt.) | The Android app                  | `pnpm run doctor` |
| Playwright chromium (optional)  | `pnpm e2e`                       | `pnpm run doctor` |

`pnpm run doctor` checks all of them and prints the command that fixes each problem. (`pnpm
doctor` without `run` is pnpm's own diagnostics.) `pnpm dev` runs the Node and ffmpeg checks
itself and refuses to start without them.

## One-time setup

**Node, through fnm.** fnm reads `.node-version`. With its shell hook, entering the repository
switches to Node 26 by itself (and installs it if needed):

```sh
brew install fnm                       # Linux: curl -fsSL https://fnm.vercel.app/install | bash
# zsh (~/.zshrc) / bash (~/.bashrc):
eval "$(fnm env --use-on-cd --version-file-strategy=recursive)"
# fish (~/.config/fish/config.fish):
fnm env --use-on-cd --version-file-strategy=recursive | source
```

**pnpm, through corepack.** Node 26 no longer ships corepack, so install it once; it then runs
exactly the pnpm version `package.json` pins:

```sh
npm install --global corepack && corepack enable
```

**ffmpeg.** On macOS `brew install ffmpeg`. Homebrew's `ffmpeg` has no `drawtext` filter, so the
fake source's test streams show no channel name or clock; `pnpm run doctor` warns and shows how to
use `ffmpeg-full` instead. Debian and Ubuntu ship ffmpeg 6 or 7; use a static build of 8 or newer
and point `SLIPSTREAM_FFMPEG` at it if it is not on `PATH`.

A wrong Node fails `pnpm install` outright (`engineStrict` in `pnpm-workspace.yaml`).
`scripts/dev-env.sh` does the fnm and corepack steps for a single shell, for agents and scripts
without the shell hook: `source scripts/dev-env.sh`.

Then:

```sh
pnpm install
pnpm run doctor
pnpm dev
```

## Running it

`pnpm dev` starts three processes with prefixed, coloured logs:

- `[source]` the fake IPTV source (`tools/fake-source`): eight channels with a generated guide
  and ffmpeg test streams, among them a German-style F1 weekend on "Sportkanal F1 HD".
- `[server]` the server under `node --watch`: it restarts when a file it imports changes, and
  shuts its ffmpeg captures down first.
- `[web]` Vite with hot reload, proxying `/api` and `/hls` to the server.

Each checkout, worktrees included, gets its own ports (derived from the checkout's path; override
with `SLIPSTREAM_DEV_PORT=<first port>`) and its own state in `.data/dev`. The first start creates
a dev admin with a generated password (printed, and kept in `.data/dev/instance.json`), adds and
refreshes the fake source, and creates the "F1 live sessions" rule and the "Formel 1" collection.
That seed goes through the public API, so production code has no dev accounts. Ctrl+C stops all
three and every ffmpeg they started.

| Command                                        | What it does                                           |
| ---------------------------------------------- | ------------------------------------------------------ |
| `pnpm dev`                                     | Everything above                                       |
| `pnpm dev --lan`                               | Listens on the network and announces itself over mDNS  |
| `pnpm dev:mock`                                | The web app alone against the in-memory mock API       |
| `pnpm dev:info`                                | URLs, dev login, data directory, whether it runs       |
| `pnpm dev:reset`                               | Deletes `.data/dev` after asking (`--yes` for scripts) |
| `pnpm --filter @slipstream/server dev`         | The server alone with this checkout's dev settings     |
| `pnpm --filter @slipstream/server db:generate` | Writes a migration after a schema change               |

`pnpm dev:mock` stays because it is the only way to run the web app without ffmpeg: `pnpm dev`
needs ffmpeg for the fake source's streams and the server's captures, and refuses to start
without it. The mock (`apps/web/src/api/mock`) implements the whole `SlipstreamApi` contract in
memory over fixtures and decides with the same domain helpers the server uses (rule matching,
record options, retention, who may edit a rule), so screens behave as they do against a real
server; it also emits the server's live events and typed errors. The web's unit tests run against it too, so it is kept in
step with the contract either way. Video plays a static test stream; anything that depends on real
captures (timeshift buffers, recordings growing, conversions) needs `pnpm dev`.

## Tests

| Tier        | What                                                        | Command          | Needs              |
| ----------- | ----------------------------------------------------------- | ---------------- | ------------------ |
| Unit        | Pure logic, HTTP round trips, the dev tooling in `scripts/` | `pnpm test:unit` | Node               |
| Integration | Real ffmpeg captures, the fake source's streams, recordings | `pnpm test`      | ffmpeg 8+          |
| End to end  | The web journey in Chromium against a fresh built server    | `pnpm e2e`       | ffmpeg, Playwright |

- `pnpm check` is the fast loop: format check, lint, typecheck and the unit tier. Run it often.
- `pnpm verify` is what CI's verify job runs: everything above `pnpm check` plus knip and the
  integration tier. Work is done when it passes.
- `pnpm e2e` builds the web app, starts the fake source and a server with a temporary data
  directory, and runs `apps/web/e2e` against it. Install the browser once with
  `pnpm --filter @slipstream/web exec playwright install chromium`.
- Every test that runs ffmpeg or ffprobe is named `*.integration.test.ts`; the unit tier
  (`test:unit`) leaves out exactly that pattern, so `pnpm check` never needs ffmpeg.

## Repository layout

```
apps/server/        Effect server: DB, scheduler, API, serves web + HLS
apps/web/           React SPA (Vite, TanStack Router/Query, Tailwind, shadcn on Base UI, hls.js)
apps/app/           Expo + react-native-tvos: one app for phone and TV
packages/domain     Effect Schemas and pure logic (rules, collections, time ranges, marks)
packages/api        The HttpApi contract (SlipstreamApi) and openapi.json
packages/sources    M3U and XMLTV parsing, source adapters
packages/recorder   ffmpeg capture (src/capture), capture manager, scheduler, retention, disk guard
packages/i18n, design-tokens
tools/fake-source   The dev and test IPTV source
scripts/            Dev tooling: pnpm dev, doctor, e2e runner (tested in scripts/*.test.ts)
```

AGENTS.md has the table with each package's dependencies.

## Conventions

- **Boundaries are lint errors** (`oxlint.config.ts`): `domain` and the app's TV guide core import only
  `effect`; web and app import server code only as `import type` and talk to the server through
  `@slipstream/api`.
- **Words** a person reads come from `packages/i18n` (English is a translation too); the
  `i18n/no-literal-text` rule enforces it in `.tsx`.
- **Colours, spacing and type** come from `packages/design-tokens`; raw colours are lint errors.
- **Effect:** services as `Context.Tag` + `Layer`; ffmpeg processes are scoped resources, killed on
  interrupt; retries through `Schedule`; no floating Effects or Promises.
- **TypeScript** is erasable only (no enums, namespaces or parameter properties): Node runs the
  sources directly. Every export has a JSDoc comment. No em dashes anywhere.
- **Versions:** `catalog:` for anything listed in `pnpm-workspace.yaml`, exact pins otherwise.

## Parallel work and agents

Work is split by ownership so several people or agents can work at once without conflicts:

- Each track owns a set of packages (for example "dx" owns root files, `scripts/` and the dev and
  build tooling; "fixes" owns application source). Nobody edits a package they do not own; root
  config changes (lint overrides, knip entries, catalog bumps) are proposed to the owner.
- Each track works in its own git worktree on a branch named `track/<name>`, branched from
  `main`. Worktrees get their own dev ports and `.data/dev`, so every track can run `pnpm dev`.
- Requests for another track go in the hand-over notes, not into their files.
- A track is done when `pnpm verify` passes for the whole repository.

## Android app and Android TV (Nvidia Shield)

The app's scripts set `JAVA_HOME`, `ANDROID_HOME` and the platform-tools themselves (macOS
defaults: Homebrew `openjdk@17`, `~/Library/Android/sdk`); `pnpm run doctor` checks them.

1. On the TV, once: Settings > Device Preferences > About, select "Build" seven times. Then
   Developer options > "Network debugging" on (Google TV: "Wireless debugging", and
   `adb pair <address> <code>` first). Note the address, e.g. `192.168.12.50:5555`.
2. Run the server where the TV can reach it: `pnpm dev --lan`. It announces itself over mDNS, so
   the app's server list finds it; the banner also prints the LAN address for manual entry.
3. Start Metro for the debug build: `SHIELD_ADDRESS=192.168.12.50:5555 pnpm app:dev`.
4. Build, install and launch: `SHIELD_ADDRESS=192.168.12.50:5555 pnpm app:tv`. It builds the
   arm64-v8a debug APK (running `expo prebuild` first if `apps/app/android` does not exist),
   installs it with `adb install -r`, forwards Metro's port to the TV and starts the app.
   `pnpm app:tv --skip-build` reinstalls the last APK.

The first connection shows "Allow USB debugging?" on the TV; choose "Always allow". Logs:
`adb -s $SHIELD_ADDRESS logcat '*:S' ReactNative:V ReactNativeJS:V`.

## Docker

`pnpm docker:build` builds the image as `slipstream:dev`; with the `build:` lines in
`docker-compose.yml` enabled, `docker compose --profile demo up -d --build` runs a checkout with the
fake source. [docs/configuration.md](docs/configuration.md) lists the
volumes and variables.

## Pull requests

Run `pnpm check` while working and `pnpm verify` before you push; CI also runs the e2e journey
and builds the image. Commit titles are short and imperative; the body says what was wrong and
how the change fixes it. One concern per commit.

## Releasing

GitHub Actions does the building (`.github/workflows`): `ci.yml` on every push and pull request,
`docker.yml` builds the image (pull requests amd64 only; main publishes `edge` and
`sha-<commit>`), `android.yml` the APK, `workflows.yml` lints the workflows with actionlint and
zizmor.

1. Bump the version in `apps/server/package.json` (what the server reports) and `apps/app/app.json`
   (`expo.version`, the app's versionName); a test keeps them equal. Commit to main.
2. Tag and push: `git tag v0.2.0 && git push origin v0.2.0` (`v0.2.0-rc.1` for a prerelease).
3. `release.yml` creates a draft release with generated notes, runs CI, pushes the image as
   `ghcr.io/zernico/slipstream:0.2.0` and attaches `slipstream-0.2.0.apk` and `SHA256SUMS.txt`.
4. Check the draft, rewrite the notes and publish it. `promote.yml` then points `latest` and `0.2`
   at that image (and `1` once there is a 1.x). Prereleases move none of them.

The image reports the tag's version (the `APP_VERSION` build argument, stamped by
`scripts/stamp-version.ts`). The APK's versionCode is derived from the version
(`plugins/with-release-signing.cjs`: `major * 1000000 + minor * 10000 + patch * 100`, plus 99 for
a release or the prerelease number), so every release installs over the last.

The APK is signed with the release key from three repository secrets: `ANDROID_KEYSTORE_BASE64`
(the `.jks` file, `base64 -i slipstream-release.jks`), `ANDROID_KEYSTORE_PASSWORD` (store and
key password) and `ANDROID_KEY_ALIAS`. The keystore and its password are kept in the maintainer's
password manager; losing them means users must uninstall to update. A local signed build:

```sh
cd apps/app && EXPO_TV=1 APP_VERSION=0.2.0 pnpm exec expo prebuild --platform android --no-install
cd android && ANDROID_KEYSTORE_PATH=… ANDROID_KEYSTORE_PASSWORD=… ANDROID_KEY_ALIAS=slipstream \
  ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a,x86_64
```

Without the three variables a release build is signed with the debug key, as before.
