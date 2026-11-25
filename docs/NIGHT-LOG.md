# Night log (2026-11-22)

Autonomous run while the owner sleeps: finish the web design, implement it, then review → fix →
review until the result is very good. Every decision is recorded here with its reason.

Roll back to the state before this run at any time: `git checkout before-web-v2` (tag).

## Plan

1. Design loop: council reviews the final prototype (incl. the owner's 17 points and
   IMPLEMENTATION-NOTES.md), a designer fixes, repeat until avg ≥ 8.5 and no serious issues (max 4 rounds).
2. Implementation of the web app from `docs/design/web-v2/final` + `SPEC.md`: foundation first, then
   screens in parallel worktrees, then integration with `pnpm verify` and the browser journey.
3. Quality loop: correctness, "patched on top" code that deserves a clean reimplementation,
   simplification (incl. whether every package should stay a package), repeat until reviewers find
   nothing significant.

## Log

### Design council (done)

| Prototype   | Visual | Product/IA | Responsive | Interaction | Avg     |
| ----------- | ------ | ---------- | ---------- | ----------- | ------- |
| A Cinema    | 8      | 7.5        | 8          | 7           | **7.6** |
| B Precision | 7      | 6.4        | 6          | 8           | 6.9     |
| C Timeline  | 6.5    | 7.8        | 7          | 6           | 6.8     |
| D Pocket    | 7.5    | 7          | 7.5        | 5.5         | 6.9     |

The council's ranking matches the owner's pick. Synthesis built `docs/design/web-v2/final/index.html`
and `final/SPEC.md` on A with all 17 owner points. Open risks it named: real artwork decode cost on
weak devices, 5.1 audio at speeds above 1×, iOS fullscreen only on the video element, server API
work for profiles/guests/default extra time/artwork sources, light-mode contrast not measured.

### Design loop (done, 4 rounds)

| Round | Avg  | Serious issues |
| ----- | ---- | -------------- |
| 1     | 6.4  | 47             |
| 2     | 7.84 | 17             |
| 3     | 7.9  | 8              |
| 4     | 8.24 | 9              |

**Decision:** stop at round 4 (max) instead of pushing the prototype to 8.5. The 9 remaining serious
issues are specific (phone landscape below 768 px: tab bar covers hero actions; resume knob over the
timeline start label; rule editor extra-time hint contradicts its steppers; recording detail of a
running recording should open the resume/from start/live choice; "New collection" name field should
select its prefilled text; Needs attention too tall on phones). They are appended to
`docs/design/web-v2/IMPLEMENTATION-NOTES.md` as binding fixes for the real build, where they have
to be solved properly anyway.

### Implementation (started)

Workflow `slipstream-web-v2-build`: contract-v2 (profiles, guests, recording defaults, collection
preview, artwork sources) and web foundation (tokens, shell, shared components, route stubs, split
i18n/mock files) in parallel, merged; then home, guide, watch, library, rules, settings-auth and
server-v2 in parallel worktrees; then an integrator merges, gets `pnpm verify` green, extends the e2e
journey, adds layout-shift tests at 1440 / 390 / 667x375 and compares every route with the prototype.

### Implementation (done)

- All 7 tracks merged without conflicts; `pnpm verify` green with **1153 tests** (web 389).
- e2e against a real server: 73 passed, 3 failed (only the cold first-visit pass of the new
  layout-shift test), 2 skipped (hover on touch). Warm loads and hover: 0 shifts on all 18 routes at
  1440, 390 and 667x375.
- Remaining cold-load shifts: /recordings (0.17 / 0.37), /rules, settings sources/users/recording.
- Integrator's "patched on" list (input for the quality loop): leftover 404 fallbacks, two skeleton
  mechanisms, `SlipstreamApi` + `SlipstreamApiAdditions` split, duplicated storage meter, mock
  importing from modules, e2e importing root scripts, shared i18n keys in the wrong area.

### Quality loop (started)

### Quality loop, round 1 (done, merged)

Scores: correctness 6.5, architecture 6, UX 7.5, security 6, app 6 (avg 6.4; 1 critical, 26 major).

Decisions:

- **One API class** (`SlipstreamApi`); the Additions/Full split and the "older server" 404 fallbacks
  are gone. Users and profiles are one API group.
- **Fewer packages:** `packages/tv-guide` moved into `apps/app/src/tv/guide` (one consumer, purity
  lint kept), `packages/capture` merged into `packages/recorder` (memory adapters behind
  `@slipstream/recorder/testing`), `fake-source` moved to `tools/`. Kept: domain, api, sources,
  recorder, i18n, design-tokens (each has real consumers or a real boundary).
- One conflict engine (the server's); free `capacity` comes from the server so conflict copy is right.
- Only active recordings block re-recording the same airing (`blocksNewRecording` in domain, shared
  by scheduler, server and web).

Fixes merged (main 432803f, `pnpm verify` green): household access gaps on collection previews and
rule previews, HLS grants bound to their range, reconnect backoff, input safety for stream URLs,
skip of waiting recordings, the app's resume progress, revoked tokens, record options from the
server instead of hard-coded padding, and cold-load layout shifts on Home, Settings and the rule
editor. e2e: 80 passed, 1 failed (cold `/recordings` CLS 0.025 with a finished recording present).

Round 2's reviews partly ran (architecture 7, security 6, app 7) before a network outage stopped
the run.

**Speed:** round 1 took 2¼ h, mostly with one agent working (a 37 min restructure, then a 15 min
merge, each alone, then one 57 min web fix). From round 2 on, work is pipelined (a fix starts as soon
as its review is planned and merges as it lands), web work is split by screen, and agents run the
affected package's tests and that screen's e2e, with the full `pnpm verify` once before the merge.

### Quality loop, round 2 (done, merged)

Scores before fixing: app 7, architecture 7, security 6, correctness 6, UX 7.5 (avg 6.7).

Decisions:

- A small `shared-helpers` step landed first (10 min). It adds domain helpers for calendar days in
  the household zone, the extra-time limits and steps, gap summaries, visible channels, record-sheet
  state, play targets and recording progress, plus one server visibility check (`seesRecording`).
  Web, app and server then switched to them instead of keeping copies.
- Extra time a person changed by hand survives re-planning (`Recording.paddingSource`).
- Rule regexes are checked for catastrophic patterns before use and only see the first 300 title
  characters; sign-in limits hold under concurrent guesses; range sessions are bounded.
- The household time zone is never guessed as UTC; screens wait for it.
- The UI limit for extra time is 0 to 240 minutes, shared by web and app.
- The web mock is a domain-backed test double instead of a second server; about 100 dead message
  keys are gone.
- Deferred: system info admin-only, retiring `pnpm dev:mock`.

Result (main bbf4711): `pnpm verify` green (1,340 tests), `pnpm e2e` **90 of 90 passed**.

**Timing:** reviews 08:38–10:12, plan 8 min, fixes 10:20–11:17 (seven agents in parallel, longest
46 min), then a serial merge queue 11:00–12:27, final 12 min. The fixes were fast now; the slow parts
were reviewers without a time box (90 min) and merge agents running e2e one after another. Next
rounds: reviewers look at what changed since the last round plus a time box, merge agents only
merge and run `pnpm check`, e2e runs once at the end.

### Quality loop, round 3 (done, merged)

Scores before fixing: correctness 6.5, architecture 7, security 8, app 7, UX 7.5 (avg 7.2; 1
critical: no client renewed the HLS token, so playback longer than an hour broke).

Decisions:

- A small `shared-contract` step first (domain `recordingsOfAiring`, `recordingGapSummary`,
  `canEditRule`, `extendPadding`, `renewalDelayMillis`; typed `RangeNotCaptured`,
  `RecordingRemoved`, stream-limit reasons; the dead-key allowlist deleted with its keys), then six
  packages in parallel.
- Catch-up ships on web and TV: an ended programme plays its captured range; the server says when
  the range has left the buffer.
- Leaving a shared recording is stored (`recording_declines`) and respected by re-planning; the
  same migration removes the old signing-key setting.
- The TV app gets the same Resume / From start prompt as the web.
- One stream-limit wording family, keyed by the API reason, for web and app.
- The app uses the household time zone, like the web.

Result (main a4f97e8): `pnpm verify` green, `pnpm e2e` **100 of 100**. The final integrator also
fixed guide search for titles with a time in them ("16:04"), a settings and a player layout shift.
Not reproduced: two hover tests hung once waiting for an animation (passed in every rerun).

**Timing:** 1 h 47 min for the whole round (round 2: 4 h), with time-boxed reviews and merges
without e2e.

## Recording model: series recordings, optional collections, repeats (done, merged)

Owner-approved follow-up to "are rules and collections confusing?" (design in
`docs/design/recording-model.md`; SPEC and PLAN 6.6 updated).

Decisions:

- **Name:** "Rules" becomes **Series recordings** / **Serienaufnahmen** (navigation: Series /
  Serien). All three council personas (non-technical household member, Plex/Channels/TiVo user,
  German UX writer) ranked it first; it is the word Sky, MagentaTV, waipu and Plex use. Code and API
  keep `Rule`; `/rules` redirects to `/series`. The German library view "Sammlungen & Serien" became
  "Sammlungen & Sendungen" so "Serien" has one meaning. Rejected: Season pass (does not translate),
  Recording schedule (clashes with Scheduled), Timer, Rules. Fallback was Auto-record.
- **Record series from a programme** is the main way in ("Record series" with episode data,
  "Record every 'Live F1'" otherwise, nothing extra for films); the editor is for refining.
- **Collections are optional and offered only when needed:** when a series' recordings would land in
  at least two automatic groups. "No thanks" is remembered. A collection made from the offer is
  linked to the series' conditions (no duplicate conditions; manual recordings still land in it).
  Deleting the series asks whether to keep the collection. Collection conditions are "Advanced".
- **Skip repeats, on by default.** Episode identity by class: event (live or sport without episode
  numbers) and broadcast (news) count as the same only with equal title + sub-title, within 24 h and
  marked as a repeat, so next week's race is never skipped and news never is; episodes by numbers or
  sub-title; films by title + year. Deleted episodes are remembered (`episode_history`), with
  "Delete and record again". Accepted trade-off: an unmarked same-day replay records twice.
- **Repeat as fallback:** a recording that failed or misses at least 60 s of the programme itself
  gets the next airing of the same episode recorded, at most 2 tries within 14 days; once the repeat
  is good the damaged one is replaced unless protected.
- Existing data: a collection is linked to a rule only when that is unambiguous; nothing moves.

Design critique before building: UX 7, engineering 6.5; the design was revised for every major point.

Result (main 20f5738): `pnpm verify` green, `pnpm e2e` **113 of 113** (new: record-series spec).
Screenshots of every flow at 1440, 390 and 390 German were reviewed.

Open (input for quality round 4): the sheet grows by 38 px when Record finishes (small layout
shift); the sheet says "1 upcoming" while the editor says "6 will record" (different definitions);
series names keep the colon ("Live F1:"); German footer buttons wrap to two lines at 390; the offer's
layout preview can read "Nachrichten › Other › Nachrichten".

## Anti-slop rework (owner feedback 2026-11-23, done in the chat, no review council)

The owner called the UI after several AI review loops "pretty terrible" and "AI slop": explaining
text everywhere, provenance badges, settings nobody needs, decorative stripes and gradients,
skeleton bars, a jumping player panel. Lesson: AI reviewers rewarded "explains itself" and
exhaustive options (round 4's UX reviewer scored it 8), so each loop added more. From here on the
owner judges the look; Infuse is the reference (Apple TV, Plex, Channels where Infuse has no
equivalent; Apple Settings for settings). A research and audit pass listed 156 places; the work
then happened directly in the chat, commit by commit:

- **Migration fix:** round 4 had edited an applied migration, so existing databases missed
  `recordings.hidden_reason` and the series preview, recordings and scheduled lists answered 500.
  The migration is restored, the additions are a new migration, and a test pins every shipped
  migration's checksum (AGENTS.md rule).
- **Settings:** no paragraph under any heading, no icon tiles. Recording is two plain menus
  (Start early / End late) plus Exceptions; the artwork order, TMDB "later" row and "Sign-in
  methods" are gone; sources are one quiet row; playback is hardware plus quality; storage is the
  meter plus two rows; avatars are flat colours.
- **Channels:** reorder by drag (dnd-kit 0.5.3, pointer, touch and keyboard), rename and
  renumber in place, set or reset a logo; a number belongs to one channel (taking one swaps); a
  channel without its own logo shows the guide's icon.
- **Programme sheet:** This episode / All episodes (or Every "Live F1"); extra time and Goes to
  folded under Options with their values as the summary; one badge; no hint sentences.
- **Series recordings:** no section numbers, summary box or "None picked means…"; extra time as
  menus with Reset; the preview's count only once it answered; near misses removed end to end;
  a card says its channels and days; Record every names the series without the colon.
- **Collections:** deletable from the editor; the generic collection suggestion removed end to
  end (the series offer is the one proposal, "“Live F1 Academy” is in 3 places. Group it?").
- **Home:** one state badge, the programme's own description, no narration, no "Generated
  artwork", no server tiles, no templates; the one-time notice feature removed end to end (a
  migration drops its table).
- **Recordings:** no intros, why-boxes, eyebrows, kind tags or artwork provenance; incomplete
  recordings say "44 min missing" under the title instead of a badge; free space instead of a
  meter in the header; no Show log buttons (the sheet only ever said there was no log).
- **Timeline and artwork:** gaps are the bare track, no stripes, dashes, gradients or pulsing;
  the dots stay round on hover; the bar grows on overrun; the live bar reaches back into earlier
  programmes still in the buffer. Generated artwork is the title on one flat tone.
- **Player:** the side panel scrolls inside its box, fades without sliding, has no key grid;
  Info is picture, sound and (only when changed) how; audio and quality are icon buttons; menus
  and errors have no essays; picture-in-picture; leaving the player while it plays keeps playing
  in a floating corner video (bar thumbnail on phones).
- **Loading:** no grey bars or shimmer; reserved space stays empty and the data fades in.
- **Guide:** no key-hint legend, no hatched cells, no pulsing marker.
- **TV app:** the same wording and fewer lines on the record sheet.

Not done: a channel menu on the guide's logos (Settings covers it), an opt-in playback statistics
overlay, a delete-then-undo for collections (a confirm instead).

## Second pass: less information, same flair (owner feedback 2026-11-24)

The owner asked whether the UI is good now; the answer was "better, not minimal yet", and the
brief became: go through it by judgement, the player feels overloaded, consider shadcn-style
selects, and the play button does not fit the glass. "Minimal doesn't mean less cool things":
motion, the live timeline, PiP and the floating player stay; only information overload goes.

- **Player (web):** play and the skips moved to a frosted-glass cluster in the middle of the
  picture (desktop and short landscape); the bottom row is From start and volume on the left,
  audio, one Options menu (quality, speed, picture, playback stats), PiP and full screen on the
  right. "Live" is said once: a small LIVE badge in the read-out, no header badge, no "You're
  watching live", no "playing 18:11:30 · live 18:43" line, no LIVE label on the timeline at the
  edge. Behind live the read-out keeps the delta, "behind live" and the broadcast time. No
  keyboard button in the header. Phone portrait: one play (the transport), chips Sound,
  Options, Info.
- **Playback stats:** opt-in from Options (remembered per device): picture size, codecs,
  delivery and encoder, stream and network bitrate, buffer, dropped frames; a quiet glass box,
  updated once a second.
- **Selects:** every native select is now one Base UI select in the input's look, the app's own
  menu with the picked option ticked (`ui/primitives/select.tsx`), including the "+ Add channel"
  pickers (quiet mode) and the grouped access picker.
- **Series editor:** extra time, episodes and Goes to fold under one Options row whose summary
  says what they are ("2 min early · 10 min late · New episodes only · Automatic"); it opens by
  itself when there is an offer to group or a linked collection. Delete asks one checkbox
  ("Also remove the collection …") under "Recordings you have stay."
- **Recording page:** one meta line under the title (channel · when · length · size) instead of
  four labelled facts; incomplete is one amber line ("2 min missing · Recording the repeat
  today 00:00") with the repeat button, not a box; no export row without a file. Repeat lines
  are short everywhere.
- **Guide:** right click or long press on a channel: Watch live, and for an admin Rename,
  Change logo, Hide channel (with Undo). No key caps on Now and prime time.
- **App:** the player's transport is round glyphs with play the one amber button, labels only
  where a glyph is not enough (Watch live, a speed other than 1×, +30 min); no LIVE chip next to
  the read-out and no surround hint. TV Home: REC only (no LIVE beside it), no "rewind to /
  recording until" captions, no repeated date. The record sheet loses its hint lines; empty
  states lose "Pick a programme in the guide and press Record."; the TV guide legend keeps only
  "Hold OK · Record".
- **Home:** Needs attention shows one row at most (four cards from 1100 px, then "N more
  problems"); the hero's resume line says only what is left (the timeline shows where).

## App parity with the web (owner request 2026-11-24)

What the web gained over the last two days that the Android app lacked, now in the app too.
Checked by typecheck, lint and unit tests only; no emulator on this machine, so nobody has seen
it on a device yet.

- **Recording sheet (TV and phone):** OK on a TV library card (a tap on phone) opens a sheet
  instead of playing straight away: the title, one meta line (channel · when · length · size),
  the problem in one amber line ("2 min missing · Looking for a repeat until Tue 24"), then the
  ways to watch (the watch choice when started, else From start / Watch live / Play), Protect
  (ticked when on) and Delete with a confirm step. TV: a side sheet; phone: a bottom sheet.
- **Phone recordings:** the phone had no way into the library; Home's header now has a
  Recordings button and the screen lists what records now, then a section per collection or
  show, with All / Unwatched.
- **Needs attention on Home (TV and phone):** failed recordings, then incomplete ones (one card
  per damaged recording and its repeats), then conflicts for an admin, in one horizontal row. A
  recording opens its sheet, a conflict the guide.
- **Player Options:** a gear button opens Quality (Auto, Original, 8 / 4 / 2 Mbit/s) and
  Fit/Fill, ticked; both are remembered on the device. A new quality goes to the running
  session and swaps the playlist the server answers with, keeping the position.
- **Shared, not copied:** the problem chains (`problemChains`, `chainKey`,
  `scheduledRepeatStart`) and the quality choices (`qualityChoices`, `qualityRequest`) moved from
  the web into `packages/domain`; web and app both read them there.
- **Server test:** `rules-ownership` picked the first programme of a guide window that also
  returns programmes already on air, so at some times of day its "upcoming" programme recorded
  at once and the test waited for a scheduled one forever. It now picks one that starts later.
