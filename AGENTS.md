# AGENTS.md

Slipstream is an open-source, self-hosted live TV, recording and timeshift app: its own server, a
web UI, and one Android app for phone and Android TV. It lets people join a programme late and
watch it from the start, pause live TV, and record by rules. AGPL-3.0. English is the source
language; German is the first translation.

`docs/architecture.md` is the design (goals, segment store, capture engine, playback, domain
model, access). `docs/design/recording-model.md` is the recording behaviour,
`docs/configuration.md` the deployment settings, and `docs/design/design-language.html` the visual
system (tokens, timeline, screen mockups). This file is orientation, rules and verification.

## Layout

| Path                     | What                                                                               | Depends on                |
| ------------------------ | ---------------------------------------------------------------------------------- | ------------------------- |
| `packages/domain`        | Effect Schemas + pure logic (rules, collections, grouping, marks, record options)  | effect                    |
| `packages/api`           | Effect `HttpApi` contract (`SlipstreamApi`), generated `openapi.json`, user codes  | domain                    |
| `packages/sources`       | M3U + XMLTV parsing, dedupe, source adapters                                       | domain                    |
| `packages/recorder`      | ffmpeg capture (`src/capture`), capture manager, scheduler, retention, disk guard  | domain                    |
| `packages/design-tokens` | Token JSON → Tailwind v4 CSS + React Native theme                                  |                           |
| `packages/i18n`          | Shared message catalogue (en, de) and path labels                                  | domain (types only)       |
| `tools/fake-source`      | Dev/test IPTV source: generated M3U + XMLTV + ffmpeg test streams                  | effect                    |
| `apps/server`            | Effect server: DB, scheduler, API, serves web + HLS                                | all packages              |
| `apps/web`               | React SPA (Vite, TanStack Router/Query, Tailwind, shadcn on Base UI, hls.js)       | api, domain, tokens, i18n |
| `apps/app`               | Expo + react-native-tvos, one app for phone + TV (TV guide core in `src/tv/guide`) | api, domain, tokens, i18n |

`packages/recorder` exposes its in-memory adapters for tests only as `@slipstream/recorder/testing`.

## Rules

- Boundaries are lint errors (`oxlint.config.ts`): `domain` and the app's TV guide core
  (`apps/app/src/tv/guide/core`) import only `effect` (the core also the domain); web and app
  import server-side code (server, recorder) only as `import type`, and talk to the server through
  `@slipstream/api`.
- Logic every client shares lives once: in `packages/domain` (time units, channel order and mark,
  programme marks, record options, series rules, playback speed), `packages/api` (user codes) or
  `packages/i18n` (path labels). Never copy it into an app.
- Every word a person reads comes from `packages/i18n` messages, English included.
- Colours, spacing and type come from `packages/design-tokens`; no raw colours in components.
- Erasable TypeScript only (Node 26 runs `.ts` directly): no enums, namespaces or parameter
  properties.
- Effect code: services as `Context.Tag` + `Layer`; ffmpeg processes are scoped resources (always
  killed on interrupt); retries via `Schedule`. No floating Effects or Promises.
- Never edit a migration in `apps/server/drizzle` once it is committed: databases that already
  ran it never see the edit. Put the change in a new migration (`pnpm --filter
  @slipstream/server db:generate`) and record its checksum in `apps/server/test/applied-migrations.json`; a test
  enforces this.
- Packages own their directory. Parallel work never edits another package or root config files;
  propose root changes (lint overrides, knip entries, catalog bumps) instead of making them.

## Verifying

- `pnpm verify` runs what CI runs: format check, lint (type-aware, zero warnings), knip, typecheck
  and tests. Work is not done until it passes.
- Smallest proof first (the one test file you touched), then `pnpm check` (format, lint,
  typecheck, unit tests; no ffmpeg), then `pnpm verify`.
- `pnpm run doctor` checks the toolchain; `pnpm dev` runs this checkout's own instance (ports and
  `.data/dev` per worktree), `pnpm dev:info` shows its URLs and dev login.
- Without fnm's shell hook, `source scripts/dev-env.sh` puts Node 26 and pnpm on PATH.
- Every "verified" claim rests on output seen in this session.
- ffmpeg 8 or newer (`MIN_FFMPEG_MAJOR` in `packages/recorder/src/capture/binaries.ts`; the Docker
  image pins jellyfin-ffmpeg 8) is required for the recorder's capture tests and the fake
  source's (`brew install ffmpeg`).
- Android builds: `source scripts/android-env.sh` first (JDK 17, Android SDK in
  `~/Library/Android/sdk`).
- Never kill processes by pattern. Kill the PID you started.

## Version pins

- `effect`, every `@effect/*` package and `drizzle-orm` share versions from the `catalog:` in
  `pnpm-workspace.yaml`; bump them together. Drizzle is `1.0.0-rc.x`, pinned exact.
- Use `catalog:` for any dependency listed there. Pin everything else exactly; never `latest`.
