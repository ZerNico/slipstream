# Recording model: series recordings, optional collections, skip repeats

Status: decided 2026-11-23 (owner-approved direction, wording from the naming council), revised
the same day after the UX and engineering reviews (§11 lists every review point and what became
of it). Binding for `packages/domain`, `apps/server`, `packages/recorder`, `packages/api`,
`apps/web`, `apps/app` and `packages/i18n`. `final/SPEC.md` (§2.4, 7.5, 7.8, 8.3–8.6, routes)
and `docs/architecture.md` agree with this file; when they disagree, this file wins until they are
fixed.

Why: today people meet two equal concepts, **Rules** and **Collections**, and the Rules page opens
with "Rules decide what gets recorded. Collections decide where it shows up." That is MythTV and
TVHeadend thinking. The products our users know (Sky and MagentaTV receivers, Plex, Channels DVR,
TiVo) have one thing: you press *record series* on a programme and it records. Slipstream keeps
its power (matchers, layouts, labels, export paths) but stops putting it in front of everybody.

## 1. Decision in one table

| | Before | After |
| --- | --- | --- |
| The thing that records by itself | Rule / Regel | **Series recording / Serienaufnahme** (short form **Series / Serien** in the navigation) |
| How you make one | Rules page, or "Record every…" in the sheet | **From a programme** (guide, programme sheet, search, TV, phone guide by long-press): *Record series* or *Record every “Live F1”*. The editor is for refining |
| Collections | Equal concept, own matcher, created anywhere | **Optional.** Offered only when a series recording's programmes would scatter in the library ("Group these as “Live F1”?"). A collection made that way **follows** the series recording's conditions |
| Conditions of a collection | A copy of the rule's matcher (three code paths copy it) | One source of truth: the series recording's *what* conditions. Own conditions are an **Advanced** option |
| Which episodes | Every matching airing; only the same airing is caught (same guide entry, or same channel + title at an overlapping time) | **Only episodes you don't have yet** (default) or **Every airing**: an episode you have or have scheduled is not recorded again, on any channel at any time |
| Failed recordings | Stay failed; a person may press *Record the repeat* | A series recording **records the repeat automatically**, found by the episode itself (any channel, any title marker), and replaces the damaged recording once the repeat is good and at least as complete |

### Naming decision

All three council personas (a 55-year-old German Sky viewer, a Plex/Channels/TiVo self-hoster, a
German UX writer) ranked the same pair first (9, 8.5, 9 of 10):

- **English:** *Series recordings*, item *series recording*. Short form *Series*.
- **German:** *Serienaufnahmen*, item *Serienaufnahme*. Short form *Serien*.

It is the word on the Sky and MagentaTV remote, on Plex ("Record Series") and on Windows Media
Center, so it needs no explanation; people use it for news and F1 too. *Auto-record* (7) stays the
fallback if the series word ever proves wrong for sport-heavy households; *Season pass* (2) does
not translate; *Recording schedule* (5) clashes with Recordings › Scheduled; *Timer* (5) means a
one-off in German; *Rules* (3–4) is what we leave.

Where the words go:

- **Short form (Series / Serien)**: the navigation item on the phone tab bar, tablet rail and
  desktop top bar, so the five navigation words stay the same on every web breakpoint and
  "Serienaufnahmen" (15 characters) never has to squeeze into a 72 px phone tab. The TV rail gets
  *Series* when the TV has its own Series list (not in this build, §3.1).
- **Full form**: page title, palette group, editor titles, toasts, sentences, empty states.
- **The footer and link that open the editor** say **Series options / Serienaufnahme ändern**
  (not "Edit series", which in a Tatort sheet reads as editing the show). The German label must
  fit next to *Trotzdem aufnehmen* in 343 px at 390 px width (e2e check); if it ever does not, the
  label wraps to the button's two-line `lg` variant, it never truncates.
- **"Rule" / "Regel" leaves every user-facing string.** It stays the internal name in code, the
  database and the API (`Rule`, `/rules`), which saves a contract migration. The editor's
  condition sections say *Conditions / Bedingungen*.
- **"Skip" means one thing**: the manual *Skip this one* on one airing. The automatic decision is
  named by its result, *Already recorded* / *Already scheduled*, never "Skipped".
- German library view "Sammlungen & Serien" becomes **"Sammlungen & Sendungen"**, so *Serien*
  means one thing. English keeps "Collections & shows".
- Route: `/series`, `/series/new`, `/series/$id`; `/rules*` redirects (old links, bookmarks). The
  shortcut becomes `G` `E` (`G` `S` is Settings).

## 2. The model in plain words

What a person sees:

1. **Recordings.** Everything recorded or scheduled. It groups itself: shows with guide episode
   data by show and season, programmes with a sub-title by show and year, films under Films, and
   everything else by title and date. Nobody has to set this up.
2. **Series recordings.** "Record every episode of Tatort", "Record every Live F1 session". Each
   one records new airings as they appear in the guide and, unless told to record every airing,
   leaves out episodes you already have.
3. **Collections** (only for people who want them). A shelf in Recordings that keeps things
   together the automatic grouping would scatter, like F1 sessions whose titles all differ.
   Mostly made with one press when Slipstream offers it.

What is stored:

| Stored | Holds | Notes |
| --- | --- | --- |
| `Rule` (shown as series recording) | matcher, padding, retention, `collectionId?`, **`skipRepeats`** (new, default true; shown as *Only episodes you don't have yet*), **`offerDeclined`** (new, read-only in the API, set by its own action), `exportTemplate?` | `seriesRule()` is still the one constructor for "Record every…" |
| `Collection` | name, rank, layout, labels, retention?, **source**: `Own { matcher }` or `FollowsRule { ruleId }` (new) | the stored row always keeps a non-empty matcher: for a linked collection it is a **snapshot** of the rule's *what* conditions, rewritten with every rule save; only `resolveCollections` turns a stored collection into a usable one (§3.4) |
| `Recording` | ProgrammeInfo snapshot, state, problems, `ruleId?`, … **`replacesId?`**, **`replacedById?`**, **`hiddenAt?`**, **`rerunOutcome?`**, **`rerunUntil?`**, **`rerunAttempts`** (new) | only terminal rerun outcomes are stored; *looking* and *scheduled* are derived on every plan (§3.7) |
| `RecordingOwner` | + **`addedByRuleId?`** (new) | lets *Undo* after *Record series* take back exactly the owners it added (§5.3) |
| `EpisodeHistory` (new table) | who had which episode, when, through which series recording | remembers deleted episodes so they are not recorded again; visible and clearable per series recording (§3.6) |

## 3. Flows

### 3.1 Record from a programme (the main way)

The programme sheet's record section keeps its two radio rows and its steppers (SPEC §8.3). What
changes is the second row, which now comes in three kinds, chosen by one domain function
`recordEveryKind(programme, context)` that is **derived from `episodeIdentity`** (§4.1), so the two
can never disagree:

| Identity class (§4.1) | Kind | Row label | Sub-line |
| --- | --- | --- | --- |
| Episode | `series` | **Record series** | Every episode of “Tatort” on Das Erste |
| Event, Broadcast | `broadcasts` | **Record every “Live F1”** | Every broadcast on Sky Sport F1 whose title starts with “Live F1:” (prefix marked, as today) |
| Film | `none` | row hidden | a film airs again, it does not continue; *Record once* covers it |

Tatort is often categorised *Fernsehfilm* and has a sub-title but no numbers: the Episode class
comes before Film (§4.1), so it gets *Record series*.

**Goes to in the sheet**: shown only when the profile can see at least one collection, or after
*More options* in the record section. The sheet's select lists *Automatic (…)* and those
collections; it has **no *New collection…*** any more, so the collection offer (§3.3) is the one
way a collection starts from the sheet. The full picker, with *New collection…*, stays in the
series recording editor. A collection-limited profile gets its own collection as today (§7.8).

Steps, web (guide cell, Channels list, phone strips, palette "In the guide" result, Home cards
that open the sheet; all open the same sheet):

1. Open the programme sheet. Footer primary is *Record* (or *Watch live* with *Record* secondary
   when it is on now), unchanged.
2. Pick *Record series* / *Record every “Live F1”*. The hint under the rows reads "Records new
   episodes from now on, only ones you don't have yet. Change it any time under Series
   recordings."
3. Extra time works as today; *Goes to* as above.
4. Press *Record*. The button is busy until the server has saved the series recording and
   replanned, **capped at 1.5 s**. The sheet then swaps once to its scheduled state.
5. The scheduled state's status box has two fixed lines: "Scheduled · by your series recording
   Tatort" and "4 upcoming" (a skeleton line while the count loads). When the offer check (§3.3)
   answers yes, the second line becomes "Shows up in 3 places in Recordings · *Group them…*" in
   the same line box, so nothing moves. *Group them…* opens the offer step below it (a shift the
   person asked for).
6. Toast: "Series recording added: Tatort · 4 upcoming" (broadcasts kind: "Series recording
   added: every “Live F1”", which teaches the word) with *Undo*.

**Undo** calls `DELETE /rules/:id?undo=true` (accepted for 10 minutes after the rule was
created): it deletes the series recording, its scheduled items, the owner rows it added to
existing recordings (`addedByRuleId`) and a collection that follows it and was created after it.
Recordings go back to automatic groups.

**What the sheet shows for an episode the viewer already has** (one table, the same in SPEC §8.3):

| Situation | Status | Badge | Record rows | Footer |
| --- | --- | --- | --- | --- |
| Viewer can see a recording that counts (§3.6) of this episode, and **none** of the viewer's series recordings decided about this airing (no series yet, or only *Every airing* ones) | `Owned { of }` | Already recorded / Already scheduled (neutral) | **both rows stay**, *Record series* offered; the status line "Already recorded Sun 22, 15:00 on ONE · Play it" sits above them | as for a not-scheduled programme (*Record* primary) |
| One of the viewer's series recordings matches this airing and left it out because the episode is had or scheduled | `Repeat { of, ruleId }` | Already recorded / Already scheduled | replaced by the status box | *Record anyway* (secondary) · *Series options* (ghost); live now: **Watch live** · *Record anyway* |
| As above, but the episode is only in the history (deleted) | `Repeat { of: history }` | Already recorded | status box "You had this episode (recorded Sun 22). It was deleted." | *Record anyway* · *Series options* |

`Owned` closes the gap where a household member's hand recording of Der Pate gave no warning.
Choosing *Record series* on an `Owned` airing creates the series recording; this airing then
becomes `Repeat` and is not recorded a second time. *Record anyway* records this airing once (a
programme recording owned by the viewer, no `ruleId`), toast "Recording Tatort anyway". The
channel is named only when it differs from this airing's.

**TV** (`src/tv/record/RecordSheet.tsx`): the *every* option row uses the same kind and label. The
hint is "Change it later in Slipstream on your phone or computer" until the TV has its own Series
list (a later build; the TV rail gets *Series* with it). The toast is "Series recording added".
After creation the offer, when it applies, appears as a second step ("Group these as “Live F1”?"
· *Group them* · *Not now*), *Group them* focused. *Not now* (and Back) only closes the step; it
does **not** set `offerDeclined`, so one accidental press loses nothing; the library card and the
web sheet carry the permanent *No thanks*. After *Group them* the TV shows a toast with *Undo*
(`DELETE /rules/:id/collection`). `Owned` and `Repeat` show the same status line as the web;
`Repeat` replaces the *Record* row with *Record anyway*.

**Phone app**: a long-press on a phone guide row (and a trailing ⋯ button on each row, for
screen readers and people who do not long-press) opens the same RecordSheet as a bottom sheet,
with the same kinds, status lines and offer step. A tap still plays.

### 3.2 Refining in the editor

`/series/$id` (from the series card, *Series options* in the sheet footer, the recording detail's
"From series recording Tatort" link). Same layout as today's rule editor (§8.6) with:

- Title "Edit series recording" / "New series recording"; summary sentence at the top.
- Sections: **Name & channels**, **Title** (conditions; regex stays behind *More options*),
  **When**, **Extra time**, **Episodes** (new, §3.6), **Goes to & Keep**.
- **Episodes** section: a two-option radio, *Only episodes you don't have yet* (default) / *Every
  airing* (field `skipRepeats`); the help line under the first option; for series recordings
  whose matches are date-identified, the note from §4.3; and, when the history has rows for this
  series recording, the line "12 deleted episodes won't be recorded again · *Forget them*", which
  clears that history for the owner (`DELETE /rules/:id/history`, confirm in place, toast).
- *Goes to* shows "Automatic (by title and date, 4 separate places)" when the programmes scatter,
  with a *Group them in a collection* inline action that opens the same offer step as §3.3. For a
  linked collection it reads "Formel 1 (follows this series recording)". Changing *Goes to* away
  from a collection that follows this series recording says under the field "Formel 1 will keep
  today's conditions and stop following this series recording" before saving (§3.4 invariant).
- A linked series recording edited by someone who may not edit collections: the conditions stay
  editable; a notice above them says "Saving changes to the conditions stops “Formel 1” following
  this series recording. The collection keeps today's conditions." (§3.4 access).
- The preview marks left-out airings with their result: "Already recorded · Sun 22, 15:00" /
  "Already scheduled · Tue 24, 20:15" next to "Same airing as a scheduled recording" (today's
  duplicate row).
- The page *New series recording* (templates row, *New* button) still exists for power users; the
  list page's empty state points to the guide first.

### 3.3 The collection offer

**When it appears.** Exactly when all of these hold:

1. The series recording has no collection (`collectionId` unset) and `offerDeclined` is false.
2. The person may create collections (the same check as *New collection…* today; collection-limited
   profiles never see it, §7.8).
3. Its programmes scatter: the recordings it made plus the matches the 8-day preview plans fall
   into **at least two different automatic groups**, and at least one of them is grouped by
   *title and date* (`fallbackPath(...).source === "title"`). Domain: `collectionOffer(items,
   context)` returns `{ name, layout, groups, examples }` or nothing.

Tatort (episode data, one show) never gets the offer. Tagesschau (one title, one group by date)
never gets it. *Live F1: 1. Freies Training - GP Katar*, *Live F1: Qualifying - GP Katar* and
*Live F1: Rennen - GP Katar* clean to three titles, three groups: offer.

**One suggestion per set of recordings.** Recordings whose `ruleId` names an existing series
recording never feed the generic suggestion (`suggestCollections`, "make Terra X a collection");
for them only the series offer exists. Declining the series offer therefore silences both. The
generic suggestion stays for hand recordings.

**Where it appears**, always in a slot that already exists:

- programme sheet after *Record*, as the second status line (§3.1 step 5);
- TV and phone record sheet, as the second step;
- the series recording editor's *Goes to* (inline action);
- Recordings › *Collections & shows*, in the existing suggestion card slot (the series offer goes
  first), once two or more of its recordings exist in different groups ("Your series recording
  “Live F1” records programmes with different titles, so they show up in 3 places. Keep them
  together?").

**What it looks like:** the inline step of today's *New collection…*: a name field prefilled from
`seriesPrefix(title).name` ("Live F1") and selected on focus, a one-line preview of the layout
from `inferLayout` ("Live F1 › 2026 › GP Katar › Rennen"), *Group them* (primary in the step) and
*No thanks* (web) / *Not now* (TV, phone).

- *Group them*: `POST /rules/:id/collection` creates a collection that follows the rule and sets
  the rule's `collectionId` in one transaction. Existing recordings of the series move into it;
  the sheet announces "Grouped as “Live F1”" in the polite live region; a toast offers *Undo*
  (`DELETE /rules/:id/collection`: deletes that collection and clears `collectionId`, does not set
  `offerDeclined`).
- *No thanks* (web sheet, library card): `POST /rules/:id/offer/decline`; never offered again for
  this series recording. The editor's *Goes to* keeps the action, so it is never lost.

### 3.4 Linked collections

A collection made from a series recording **follows** it. One source of truth:

- **Effective matcher** = the series recording's *what* conditions: channels, title conditions,
  categories. Its *when* conditions (weekdays, duration) decide what gets recorded, not what a
  programme is, so they are left out: a Saturday press conference recorded by hand still lands in
  Formel 1. Labels of the collection still apply.
- **Types make it impossible to skip resolving.** Domain: `StoredCollection` has `source: Own {
  matcher } | FollowsRule { ruleId, snapshot }`; the domain `Collection` (with `matcher`) is only
  produced by `resolveCollections(stored, rules)`. Placement, specificity, overlap, preview,
  suggestion, export and retention take `Collection`, so a stored matcher cannot reach them
  unresolved. When the rule is missing (it never should be, see FK below), the snapshot is used,
  never an empty matcher, so nothing fails open.
- **The snapshot** (the row's `matcher` column) is rewritten in the same transaction as every save
  of the followed rule. It is what unlinking copies and what the migration compares (§6).
- **Invariant**: `collection.ruleId = R ⇒ R.collectionId = collection.id`. Enforced in
  `Rules.save` (*Goes to* changed away from the followed collection unlinks it: source becomes
  `Own` with the snapshot), `Rules.remove`, user deletion and `Collections.remove`; a domain
  `linkProblems` check and server tests cover each path. A collection follows at most one series
  recording (unique `rule_id`); other series recordings may still point at it through *Goes to*.
- **FK**: `collections.rule_id … on delete restrict`. Deleting a rule (service) or a user (whose
  rules cascade) first unlinks or removes the following collections in the same transaction, so
  the database never silently turns a link into a standalone collection with an unknown matcher.
- **Manual recordings** that match those conditions land in it like any collection (precedence
  unchanged: pinned by hand › the series recording's collection › most specific matcher ›
  ranking). Specificity is computed from the effective matcher.
- **When the series recording changes** its channels, title or categories, the collection's
  contents follow on the next grouping. If that moves exported files, saving asks the question a
  collection rename asks today ("Move 12 files? Plex may re-scan"). Pausing it changes nothing in
  the library.
- **Access**: only people who may create collections can link (the offer is only shown to them).
  A series recording that a collection follows can still be edited by its owner; when the owner
  may not edit collections and the save changes the *what* conditions, the server unlinks the
  collection first (it keeps the snapshot as its own conditions) and the editor says so before
  saving (§3.2). So a regular user can never change a household-wide collection through their own
  series recording. Otherwise access is unchanged: a series recording counts as the collection it
  records into (§7.8), and the collection is household-wide.
- **When the series recording is deleted**: the confirm asks *Keep the collection “Live F1”*
  (default; it keeps the snapshot as its own conditions and stops following) or *Remove the
  collection* (its recordings go back to automatic groups). Non-admins who may not edit
  collections get *keep* without the question, and the toast says "The collection Live F1 stays".
- **When the collection is deleted**: the series recording keeps recording (`collectionId` set
  null, as today); `offerDeclined` is set so the offer does not return straight away.

### 3.5 Advanced collection conditions

Normal users see a collection as a name, a layout and *Keep*. The collection editor (§8.5)
changes:

- *What belongs in it* moves into an **Advanced** disclosure ("Advanced: what belongs here"),
  closed by default. It is open when the conditions are empty or invalid (a brand-new collection
  from *New collection*) and when the editor is opened from *Make it a collection* with
  `?advanced=1`.
- A linked collection shows, in place of the conditions, one line: "Follows the series recording
  “Live F1”: Sky Sport F1, titles starting with “Live F1:”" with *Series options*. Inside
  Advanced: *Use its own conditions instead* (`POST /collections/:id/unlink`; copies the effective
  matcher; "Later changes to the series recording no longer change this collection").
  `PATCH /collections/:id` with a matcher on a linked collection is refused (409, problem
  `FollowsRule`).
- Unlinked collections (all existing ones, ones made by hand, by *Make it a collection* or by a
  suggestion) keep their own matcher exactly as today.

### 3.6 Which episodes (skip repeats)

Per series recording, a choice of two, **Only episodes you don't have yet** being the default (new
and existing; existing households are told once, below). With it, an airing a series recording
matches is left out when the same **episode** (§4) already exists as a recording that counts, or
is in the episode history of the series recording's owner.

Counts: `completed`, `incomplete` that does not need a repeat (§5.1), `recording`, `scheduled`
(also scheduled by another series recording or by hand) **unless that scheduled recording cannot
be served** in the current conflict result (§5.2). Does not count: `failed`, `cancelled`, hidden
(replaced) recordings and recordings that need a repeat. Only recordings the series recording's
owner may see count (`seesRecording`): a restricted profile's series recording never leaves an
airing out because of something it cannot see, so nothing leaks; it records its own copy.

**Decided per (series recording, airing).** Each matching series recording decides on its own,
against its owner's visible copies and history. The airing is planned when at least one decides
to record; its `ruleIds` are those that did, and the first of them owns it. Those that left it out
add their owner to the existing copy (§5.3).

The earliest airing that can be served wins (planning goes by start time), so an episode that airs
on Das Erste on Sunday and on ONE on Tuesday is scheduled on Sunday, and Tuesday shows "Already
scheduled Sun 22, 20:15". Simulcasts (HD and SD at the same time) collapse into one recording the
same way.

*Skip this one* (cancelling one scheduled airing) stays airing-specific: it keeps today's
tombstone and does not stop a later repeat of that episode being recorded.

**History.** Deleting a **good** finished recording (completed, or incomplete without needing a
repeat) of a series recording set to *Only episodes you don't have yet* writes an
**EpisodeHistory** row for each owner, so the repeat next month is not recorded again. Retention
(KeepNewest deleting old episodes) does the same, so it does not record and delete the same
episode in a loop. The delete confirm for such recordings has a second button, *Delete, record it
again when repeated*, which skips the history row. History is never invisible: the editor's
Episodes section shows how many deleted episodes it keeps out and offers *Forget them* (§3.2).

**Deleting a recording that needs a repeat never writes history**: people delete a broken
recording because it is junk and still expect the episode. Its fallback keeps looking (§3.7); the
confirm's secondary button is *Delete and stop looking for a repeat*.

**Upgrade notice**: the migration turns the default on for every existing series recording. Each
person who owns at least one sees a one-time, dismissable Home card in the Needs attention slot:
"Series recordings now leave out episodes you already have · Review", linking to `/series`.

**In the guide:** an airing the viewer already has (`Owned`) or one of the viewer's series
recordings left out (`Repeat`) gets a quiet mark: a neutral `--fg-3` check in the cell's marker
slot (where the red dot / amber ring sit, so no geometry changes), label "already recorded" or
"already scheduled" in the cell's aria label. `MarkState` gains `repeat`. Source: `GET
/guide/repeats` (§7), which covers both cases for what the viewer may see.

**In the programme sheet:** the table in §3.1. No primary when the airing is left out and not
live: nothing is the obvious next step, and two secondary buttons keep the 73 px footer.

### 3.7 Repeat as fallback

When a recording made by a series recording **needs a repeat** (§5.1), the next airing of the same
episode is recorded automatically and the damaged recording is replaced once the repeat is good
and at least as complete. This works with either episode choice in §3.6.

**Finding the repeat goes by the episode, not by the rule's conditions.** A Tatort repeat on ONE
fails the rule's channel condition; the replay "F1: Rennen - GP Katar (Wh.)" fails the condition
*title starts with “Live F1:”*. So the fallback never asks the matcher. Domain:
`findRepeatAiring(damaged, programmes, context)` returns the earliest programme that

- starts after the damaged recording's programme ended and before `rerunUntil`,
- is the same episode (`sameEpisode`, §4.2; both F1 titles have the show key `f1: rennen - gp
  katar` because `cleanTitle` strips the leading "Live" and the trailing "(Wh.)"),
- is one **every** owner of the original may see: its channel and, for a collection-limited
  profile, the place the repeat would land (`sees`),
- is served in the current conflict result when any served candidate exists (§5.2).

*Skip this one* on a planned repeat needs no per-airing tombstone: it sets the chain's
`rerunOutcome: declined` (step 7), and a declined chain looks for nothing again.

The rule's title, channel, weekday and duration conditions are ignored on purpose; the series
recording already said it wants this episode.

**State.** Only terminal outcomes are stored; everything else is derived on every plan, so a
replan is idempotent and a guide change can never leave a pointer to nothing. Domain
`rerunState(original, chain, plan, now)`:

| Derived state | When |
| --- | --- |
| `replaced` | `original.replacedById` is set |
| `kept` / `declined` / `exhausted` | `original.rerunOutcome` says so |
| `scheduled` | the current plan has a recording with `replacesId = original.id` |
| `looking` | the original needs a repeat, `now < rerunUntil` and `rerunAttempts < 2` |
| `exhausted` (derived) | needs a repeat, but the deadline passed or two attempts failed |

Stored on the **original** (the first damaged recording of the episode): `rerunUntil` (its
programme end + 14 days, written by `finish`/`missed`), `rerunAttempts` (incremented when a repeat
in its chain ends needing a repeat itself), `rerunOutcome` (`kept`, `declined`, `exhausted`),
`replacedById`, `hiddenAt`. **Chain**: every repeat's `replacesId` points at the original, never at
an earlier repeat. Once one copy in the chain is good, every damaged copy in it is resolved.

1. `finish` or `missed` ends the recording `failed` or `incomplete`. If it needs a repeat and has a
   `ruleId`, `rerunUntil` is written; the scheduler sets `dirty` and nudges (it must not re-enter
   the tick lock).
2. Every plan: `findRepeatAiring` for each original in state `looking` whose episode no good
   repeat holds yet. The airing is planned as a derived recording with `replacesId`, the
   original's `ruleId` and owners; if a rule match or another original already planned that
   airing, the plan's `replaces` (a list) gains the original instead of a second item. Several
   damaged originals of one episode (on different channels, for different people) share one
   repeat, owned by all their owners; the stored repeat's `replacesId` names the first, and the
   scheduler finds the others again when the repeat ends. A repeat
   further out than the planning horizon (8 days, `PLANNING_HORIZON_MILLIS`) is picked up when it
   enters it; until then the state is `looking`.
3. The repeat finishes. It **replaces** the original only when all hold: it does not need a
   repeat itself; its programme length is at least **90 %** of the original's programme length
   (a 90-minute race replay against a 150-minute live broadcast is not a replacement); it has
   fewer missing seconds than the original, both measured against the repeat's **guide** length
   (a repeat stopped at 92 % misses 8 %); and nobody stopped it (a stopped repeat never replaces:
   both are kept). Then each original (and any failed repeats before it) get `replacedById`,
   `hiddenAt` and `hiddenReason: replaced`; an original a person deleted while the chain looked
   (an anchor, `hiddenReason: deleted`) stays deleted and gets no `replacedById`, so it can never
   be kept; they disappear from the library, Problems, counts and
   retention, but keep their segments for **7 days** (purged by the retention janitor). The repeat
   inherits owners, labels and pinned collection, and starts unwatched (positions do not carry
   over; gaps shift the timing). Its detail offers *Keep the original* during those 7 days
   (`POST /recordings/:id/keep-original`: clears `hiddenAt`/`replacedById` on the original, sets
   `rerunOutcome: kept`; both stay). Server event `RecordingReplaced`.
4. A good repeat that fails the 90 % or missing-seconds test: both are kept, `rerunOutcome: kept`,
   and the issue card resolves as "Repeat recorded too".
5. If the repeat needs a repeat too, `rerunAttempts` goes up and step 2 runs again. At most **two**
   repeats per episode; then `exhausted`.
6. Looking stops after **14 days** (`rerunUntil`).
7. It stops for good (`rerunOutcome: declined`) when the person chooses *Delete and stop looking
   for a repeat*, uses *Skip this one* on the planned repeat, or deletes the series recording.
   Plain *Delete* of the damaged recording keeps looking: the row stays hidden (segments deleted
   at once, `hiddenAt` set) as the chain's anchor until the chain ends.
8. A **protected** original is never hidden: the repeat is recorded, the issue resolves as
   `kept`, and the detail says "Kept because it is protected".

Live events: the same-evening replay of a race is a repeat of it (§4.3), so a failed race is
re-recorded from the replay. Next week's race is never a repeat.

Manual (one-off) recordings keep the manual button SPEC §8.4 already has (*Record the repeat*, when
the guide lists one), which now uses `findRepeatAiring` to find it.

**Where people learn about it:**

- Home › Needs attention and Recordings › Problems: one issue card per chain (keyed by the
  original) changes its text and keeps its place ("Tatort had gaps · Recording the repeat Wed 25,
  22:00 instead"), and disappears once the repeat replaced it. A short-lived ok card "Tatort
  replaced by the repeat from Wed 25" sits in the same slot for 24 hours (dismissable).
- Recording detail of the damaged one: the problem box adds the line; of the repeat: facts say
  "Replaces the recording from Sun 22, which had gaps" with *Keep the original*.
- The TV app gets `RecordingReplaced` and shows a toast if it is open. Push notifications follow
  when notifications exist; this event is the one they will use.

## 4. Episode identity

One domain module (`packages/domain/src/episode.ts`), used by the scheduler, the rules preview,
record options, guide marks, the web mock and the TV. **Rule of thumb: no identifying data, no
repeat.** When unsure, record; an extra recording costs disk, a missed one costs the episode.

### 4.1 Classes

`episodeIdentity(info, context)` sorts a programme or recording into one class, first match wins:

1. **Event** (date-identified): `live` is true, **or** a sport category without episode numbers.
   This comes first on purpose: Sky's F1 broadcasts often carry a sub-title like "Großer Preis
   von Katar", and next year's race has the same sub-title.
2. **Episode**: guide episode numbers (`episode.episode`), or an **identifying** sub-title.
3. **Film**: a film category (`defaultFilmCategories`) without episode numbers and without an
   identifying sub-title.
4. **Broadcast** (date-identified): everything else (Tagesschau, talk shows, magazines).

A sub-title is **identifying** unless it is

- empty, a date, a weekday or a repeat marker;
- equal (normalised) to the show key, the channel's name or one of the programme's categories; or
- **generic for the show**: `context.genericSubtitles` holds it. Domain
  `genericSubtitles(items, timeZone)` is computed once per plan from the guide window and the last
  30 days of recordings: a (show key, sub-title) pair is generic when it appears on **three or
  more distinct local days** and those airings carry **at least two different descriptions** (or
  no descriptions at all). "Das Magazin", "mit Wetter" or "Nachrichten" every day is generic; a
  Tatort episode repeated three times with its one description is not.

A show whose sub-titles are generic falls through to Film or Broadcast, so each day's new broadcast
is recorded. That is the "when unsure, record" direction: a wrong demotion costs disk.

The show key is `normaliseText(cleanTitle(title)).toLowerCase()` (cleanTitle already strips a
leading "Live", "(Wh.)", "(Wdh.)" and "- Live"; "Live F1: Rennen - GP Katar" and "F1: Rennen - GP
Katar (Wh.)" share one key).

### 4.2 Same episode

| Class | Same episode when |
| --- | --- |
| Episode | same show key, and: both have numbers → same season (or both without season) and same episode, **unless** both have different identifying sub-titles (a guide error: record); else both have identifying sub-titles → same normalised sub-title (providers number differently across channels, so equal sub-titles win over unequal numbers). **Description guard**: when both have descriptions of 40+ characters and their word sets overlap less than 50 % (Jaccard on the first 300 characters), they are not the same episode |
| Film | same show key and both have `originalAirDate.year` and the years are equal. No year on either side: never the same (two films can share a title; remakes) |
| Event | same show key; sub-titles equal **when both have one** (Sky's live airing has "Großer Preis von Katar", the replay often none); the later one starts on the **same or the next local calendar day**; and the later one is **marked as a repeat**: the guide's repeat flag, a repeat marker in the raw title, or (the earlier was live, the later is not, the later's programme length is within **20 %** of the earlier's, **and** a positive signal says replay: an equal non-empty sub-title, or a start within **12 hours** of the live airing's end). Without that signal next day's unflagged Bundesliga match would be "the same" as Saturday's |
| Broadcast | same show key; sub-titles equal when both have one; the later one starts within **24 hours** of the earlier one's start; and the later one is marked by an **explicit** signal only: the guide's repeat flag or a repeat marker in the raw title. The live → not-live inference does **not** apply (EPGs flag Tagesschau 20:00 live; the 00:00 edition is a different broadcast) |

The guide's repeat flag is therefore only a hint for episodes and films (a repeat of an episode we
never had is recorded), and the required signal for date-identified programmes.

Planning builds `episodeIndex(recordings, history)` once per plan, keyed by show key (history is
indexed by `user_id, show_key`), so `findRepeat` does not scan the library for every programme.

### 4.3 Worked examples

| Airing | Earlier | Result |
| --- | --- | --- |
| Tatort, Folge 1247 "Unter Wölfen", ONE, Tue | same on Das Erste, Sun, completed | left out: Already recorded Sun 22, 20:15 on Das Erste |
| Tatort "Unter Wölfen" without numbers, WDR | Folge 1247 "Unter Wölfen", completed | left out (sub-titles equal) |
| Tatort "Unter Wölfen", category Fernsehfilm, no numbers | — | Episode class, *Record series* offered |
| Tatort "Unter Wölfen", ONE, Tue, different description (word overlap 20 %) | Folge 1247 "Unter Wölfen", completed | recorded (description guard) |
| Live F1: Rennen - GP Katar, live, Sun 17:00 | — | recorded |
| F1: Rennen - GP Katar (Wh.), Sun 22:30 | the live race, completed | left out (same event, same day, marked) |
| same replay, live race **failed**; rule is *title starts with “Live F1:”* | the live race, failed | found by `findRepeatAiring` (the matcher does not match it), recorded as the repeat that replaces it |
| F1: Rennen - GP Katar, Sun 21:00, not live, unmarked, no sub-title, 2 h 25 min | the live race Sun (live, 2 h 30 min), completed | left out (live → not live, length within 20 %, within 12 h of the race's end) |
| F1: Rennen - GP Katar "Großer Preis von Katar", Mon 10:00, not live, 2 h 25 min | the live race Sun (live, 2 h 30 min), completed | left out (next day, live → not live, length within 20 %, equal sub-title) |
| Bundesliga, Sun 15:30, neither live nor repeat, no sub-title | Bundesliga live Sat 15:30, same length, completed | recorded (no sub-title and more than 12 h after Saturday's match: another match) |
| F1: Rennen Highlights - GP Katar, Mon, 30 min | the live race | recorded (different show key) |
| Live F1: Rennen - GP Katar, a year later | last year's race, completed | recorded (not the same or next day) |
| Live F1: Rennen - GP Abu Dhabi, next week | GP Katar | recorded (different title) |
| Tagesschau 20:00, every day | yesterday's | recorded (not marked) |
| Tagesschau 20:00 (flagged live) and 00:00 (not live) | the 20:00 edition | both recorded (Broadcast: no live → not-live inference) |
| Tagesschau 20:00 and 12:00 the same day | | both recorded (neither marked) |
| "Brisant" with sub-title "Das Magazin" every weekday, changing descriptions | yesterday's | recorded (generic sub-title → Broadcast) |
| Markus Lanz (Wdh.), 03:00 next night | Markus Lanz 23:15, completed | left out |
| Der Pate (1972), arte | Der Pate (1972), completed | left out |
| Der Pate, no year in the guide | Der Pate (1972) | recorded |
| Sportschau, Sat (sport, no numbers, not live) | last Saturday's | recorded (not marked) |

Trade-off accepted: an unmarked same-day sport replay ("F1: Rennen - GP Katar" at 22:30 without
"(Wh.)" or repeat flag, while the race was not flagged live either) is recorded twice. The editor
says so in the Episodes section for series recordings whose matches are date-identified: "For live
events and programmes without episode data, “don't have yet” goes by date: every new broadcast is
recorded, only a marked repeat on the same or next day is left out."

## 5. Rules for the recorder

### 5.1 When a recording needs a repeat

Domain `needsRepeat(recording)`, shared by server, web and TV:

- the recording is `failed`, or `recordingGapSummary(recording).failed`; or
- at least **60 seconds** of the programme itself (start to end, **not** the extra time) are
  missing (`repeatGapThresholdMs = 60_000`, exported from the domain).

Gaps only in the extra time never count; micro-stalls under a minute are not worth a second
capture. "Incomplete" (any stretch over 15 s) stays the state name and wording; it is a wider net
than "needs a repeat".

### 5.2 Planning

`planRecordings(rules, programmes, existing, context)` keeps its shape (`context` gains
`history`, `access`, `unserved`, `now`, `timeZone`; a missing context keeps today's behaviour) and
gains, per programme and after the same-airing check:

```
same airing (findDuplicate, unchanged) → skip "AlreadyScheduled" (tombstones keep working)
duplicate guide entry                   → skip "DuplicateEntry"
per matching rule with skipRepeats:
  same episode (findRepeat)             → that rule skips "Repeat" with `of`
planned when ≥ 1 matching rule records; then, for each looking original:
  findRepeatAiring                      → plan (or annotate) with `replaces`
```

- `findDuplicate` and `sameAiring` do **not** change: `recordOnce`, `recordingsOfAiring`,
  `programmeMarks` and `recordingOfProgramme` keep their meaning.
- New `findRepeat(candidate, index, context)` takes a wider structural type:
  `EpisodeRecording = ExistingRecording & Pick<ProgrammeInfo, "episode" | "originalAirDate" |
  "repeat" | "live" | "categories" | "description"> & { state, problems, padding, ruleId?,
  ownerIds, hiddenAt? }`. `Recording` and library entries fit it; `Programme` fits the candidate
  side.
- Planned items are matched against each other too (an episode twice in the next 8 days is
  planned once).
- **Conflicts.** The scheduler plans in at most two passes: pass 1 plans; it then runs
  `detectConflicts` over existing and planned items. When a planned or scheduled item of a
  series recording is unserved and the same episode has a later airing, pass 2 replans with those
  items in `context.unserved`: an unserved scheduled copy does not count for skipping, and
  `findRepeatAiring` prefers served airings. The unserved copy stays scheduled (limits may change);
  once one copy completes, the other becomes a repeat and is dropped on the next plan. The manual
  "Record the repeat instead" in the conflict box stays for when no served airing exists.
- The preview (`Rules.preview`) and the web mock (`api/mock/rules.ts`, `schedule.ts`) call the
  same function. `RuleMatchPreview.duplicate` becomes `skip: SameAiring | DuplicateEntry |
  Repeat`.
- **One planner.** Domain `planHousehold({ rules, programmes, recordings, access, now,
  timeZone })` is the whole household plan: it builds the context (generic sub-titles from the
  guide window and the recordings that ended in the last 30 days), plans from the recordings
  minus the derived ones (scheduled with a rule), asks `access.unserved` about the active,
  visible fixed recordings and pass 1's plan, and runs pass 2 with the items that moved. The
  scheduler, the server's `Planning` service (preview, offer, guide repeats, record options) and
  the web mock all call it; `access` is the recorder's `PlanningAccess` port.
- `GET /guide/repeats` is computed by the server from that plan, so it needs no channel into the
  recorder; it is cached and the cache is dropped on every replan event, recording change and
  `HouseholdChanged` (a profile, its access, a rule, a collection or the settings).
- Record options take the plan's context (`episodes`) and, for a programme the plan cannot serve,
  `repeatAiring`: the plan's `findRepeatAiring` with its full context, for every owner of the
  recording (`conflictRepeatAiring`).

### 5.3 Owners

When a series recording leaves an airing out because a visible recording of the episode exists,
its owner is added to that recording's owners (today's `withOwners` behaviour for same-airing
duplicates, extended to repeats), with `addedByRuleId` set, so it shows up in their "Mine" and
their series' count and *Undo* can take it back exactly. A declined recording
(`recordingDeclines`) is not re-owned.

### 5.4 Retention

- Recordings whose chain is `looking` or `scheduled` are never deleted by retention.
- A damaged original and its repeat count as **one** episode for KeepNewest / KeepNewestEvents
  (counted by chain); hidden (replaced) recordings do not count at all and are purged 7 days after
  `hiddenAt`.
- Retention deleting a good recording writes history (§3.6); it never writes history for one that
  needs a repeat.

## 6. Data model and migration

One drizzle migration (`pnpm --filter server db:generate`), forward-only, written only by the
server work package:

| Table | Change | Existing rows |
| --- | --- | --- |
| `rules` | `skip_repeats integer not null default 1`; `offer_declined integer not null default 0` | *Only episodes you don't have yet* for existing series recordings (owner default), with the one-time Home notice (§3.6) |
| `collections` | `rule_id text unique references rules(id) on delete restrict` | null: every existing collection stays standalone with its own matcher |
| `recordings` | `replaces_id text references recordings(id) on delete set null`; `replaced_by_id text references recordings(id) on delete set null`; `hidden_at integer`; `rerun_outcome text` (`kept`, `declined`, `exhausted`; null = none); `rerun_until integer`; `rerun_attempts integer not null default 0` | null / 0 |
| `recording_owners` | `added_by_rule_id text references rules(id) on delete set null` | null |
| `episode_history` (new) | `id`, `user_id` (cascade), `rule_id` (set null), `show_key`, `season`, `episode`, `subtitle_key`, `film_year`, `class`, `aired_at`, `channel_id`, `title`, `created_at`; index on (`user_id`, `show_key`) and on (`rule_id`) | empty; old deletions are not known, accepted |

After the SQL migration, a one-time startup step (TypeScript, idempotent, one transaction together
with its settings flag) **links** a collection to a rule when all hold:

- exactly one rule has `collectionId` = that collection;
- the collection has no labels;
- the collection's matcher **equals** the rule's *what* conditions: channels as a set; title
  conditions as a set of (kind, `normaliseText` value, case flag); categories as a
  case-insensitive set; the rule's weekdays and duration bounds are ignored; the collection's own
  duration bounds must be empty.

Linking keeps the collection's matcher column as the snapshot (equal by the test above), so
nothing is lost and a wrong link is undone with *Use its own conditions instead*. Anything else
stays standalone; nothing moves. The same step sets the per-user notice flag for owners of
existing rules. Tested on a fixture database with existing F1 rules and collections (linked,
not linked because of labels, not linked because two rules point at it).

Code that has to change with the columns: `rules/store.ts` `toRule`, `Rules.save` (values and
`onConflictDoUpdate` set, snapshot rewrite), `recorder/repos.ts` `RuleRepoLive` and the recording
repo, `recordings/store.ts` `toCollection` (now returns `StoredCollection`) and `loadCollections`
(resolves), the recorder's memory adapters, the web mock fixtures and the TV app's `createRule`
call (it sends `seriesRule(...)`, which sets `skipRepeats: true`).

## 7. API changes

`packages/api` (regenerate `openapi.json`; update `contract.test.ts` and the web mock's contract
test):

- `Rule`: `skipRepeats: boolean`, `offerDeclined: boolean` (read-only). `RuleInput` (create):
  `skipRepeats` optional, decodes to `true`, so older TV builds keep working; it does not take
  `offerDeclined`. `RuleUpdate` (PATCH): `skipRepeats` optional, **omitted means keep**, so an
  older client editing a rule never resets it (contract test with an old-client body).
- `POST /rules/:id/offer/decline` → `Rule` (sets `offerDeclined`). `GET /rules/:id/offer` →
  `{ offer?: CollectionOffer }`. `RulePreview` gains `offer?: CollectionOffer` (`{ name, layout,
  groups: number, examples }`).
- `RuleMatchPreview`: `skip?: { _tag: "SameAiring" } | { _tag: "DuplicateEntry" } | { _tag:
  "Repeat"; of: RepeatRef }` replaces `duplicate`. `RepeatRef = { recordingId?, start, channelId,
  state: "completed" | "incomplete" | "recording" | "scheduled" | "history" }`.
- `POST /rules/:id/collection` `{ name, layout? }` → `Collection` (creates a linked collection and
  sets the rule's `collectionId`, one transaction; 403 without collection permission).
  `DELETE /rules/:id/collection` → 204 (undo of *Group them*).
- `DELETE /rules/:id?collection=keep|remove&undo=true` (keep is the default; `undo` within 10
  minutes of creation, else 409).
- `GET /rules/:id/history` → `{ count }`; `DELETE /rules/:id/history` → `{ count: 0 }` (the
  actor's rows for that rule).
- `Collection` gains `follows?: { ruleId, ruleName }` and its `matcher` is always the effective
  one. `CollectionInput` does not take `follows`; a matcher change on a linked collection is 409
  `FollowsRule`. `POST /collections/:id/unlink` → `Collection`.
- `GET /guide/repeats?from&to` → `Array<{ programmeId, ruleId?, of: RepeatRef }>`: `ruleId` set
  when one of the viewer's series recordings left the airing out, absent when the viewer merely
  has the episode. Filtered by `seesRecording`; computed with the planner's own function (§5.2).
  Feeds the `repeat` mark on web and TV.
- `ProgrammeRecordingStatus` gains `Owned { of: RepeatRef }` and `Repeat { of: RepeatRef, ruleId }`
  in `GET /programmes/:id/record-options`; only returned when the viewer may see `of`, else
  `NotScheduled`.
- `RecordingEntry` gains `replaces?: { recordingId, start, channelId }` and `rerun?: { state:
  "looking" | "scheduled" | "replaced" | "kept" | "declined" | "exhausted", repeat?: { recordingId,
  start, channelId }, until? }`. Hidden recordings are left out of lists; `GET /recordings/:id`
  still returns them (for *Keep the original*).
- `DELETE /recordings/:id?history=skip` (*Delete, record it again when repeated*) and
  `?rerun=stop` (*Delete and stop looking for a repeat*). `POST /recordings/:id/keep-original`.
- `GET /me/notices` → `Array<{ id: "skipRepeatsIntroduced" }>`; `POST /me/notices/:id/dismiss`.
- Server events: `RecordingReplaced { id, replacedId }`; `RecordingEnded` carries `rerun`.

## 8. Edge cases

- **Guide data changes** after a decision (episode numbers corrected, repeat flag added): every
  plan re-evaluates; a now-planned or now-left-out airing changes like any rule match today. A
  planned repeat that disappears from the guide returns the chain to `looking` (derived).
- **Switching to *Every airing*** schedules the airings that were left out on the next plan;
  switching back removes not-yet-started derived recordings that are now repeats (as today for
  unmatched ones). Neither switch stops a running fallback.
- **Conflicts**: §5.2. When nothing served exists, the conflict box (§8.3, §8.4) adds "Record the
  repeat instead (Wed 25, 22:00)".
- **Record anyway** creates a one-off recording; the series recording then sees the same airing
  and does not plan it a second time.
- **A repeat marked live** (some guides flag re-broadcasts as live): the raw-title marker or the
  repeat flag still identifies it.
- **The earlier copy is being recorded right now** and fails: it needs a repeat, the later airing
  (previously left out) is planned with `replaces`.
- **Protected damaged recording**: §3.7 step 8.
- **The user watched part of the damaged recording**: the replacement still happens; their
  position is not carried over (gaps change the timing), and the repeat shows as new.
- **History and household**: history rows are per owner; Mara deleting her Tatort does not stop
  Jonas's series recording.
- **Linked collection and a regex series recording**: the effective matcher carries the regex and
  its named groups, so `{named}` layout parts and the export template keep working.
- **Rename of a linked collection** moves exported files with the existing question; renaming the
  series recording does not rename the collection (the name is the collection's own).
- **Export paths**: a linked collection's `{group}` path is the collection's; unlinking keeps the
  path, so nothing moves.
- **Kids / guests** never see the offer (they cannot create collections); their series recordings
  record into their own collection (§7.8), so scattering cannot happen for them.
- **User deletion** with linked collections: the household service unlinks (keeps the snapshot)
  before the cascade; the restrict FK makes forgetting this a failing test, not silent data loss.

## 9. Copy (en + de)

Every string goes into `packages/i18n` (shared keys in `messages/en.ts` / `de.ts`, TV and phone in
`messages/app/*`, web areas in `messages/web/*`). Message keys follow the words (`nav_series`,
`series_*`); `rules_*`, `rule_*` keys are renamed, not duplicated. Days use the pill notation
("Sun 22" / "So 22"); relative days are lower case inside sentences.

| Where | English | German |
| --- | --- | --- |
| Navigation (web) | Series | Serien |
| Page title, palette group | Series recordings | Serienaufnahmen |
| Page intro | Shows and events Slipstream records for you. Start one from any programme in the guide. | Sendungen und Events, die Slipstream für dich aufnimmt. Starte sie direkt im Programm bei einer Sendung. |
| Empty state | No series recordings yet · Pick a programme in the guide and choose Record series. · [Open the guide] | Noch keine Serienaufnahmen · Wähle eine Sendung im Programm und dann „Serie aufnehmen“. · [Zum Programm] |
| New / edit | New series recording · Edit series recording | Neue Serienaufnahme · Serienaufnahme bearbeiten |
| Footer / link to the editor | Series options | Serienaufnahme ändern |
| Sheet row, series | Record series · Every episode of “{title}” on {channel} | Serie aufnehmen · Alle Folgen von „{title}“ auf {channel} |
| Sheet row, broadcasts | Record every “{name}” · Every broadcast on {channel} whose title starts with “{prefix}” | Immer „{name}“ aufnehmen · Jede Übertragung auf {channel}, deren Titel mit „{prefix}“ beginnt |
| Sheet hint | Records new episodes from now on, only ones you don't have yet. Change it any time under Series recordings. | Nimmt ab jetzt neue Folgen auf, nur solche, die du noch nicht hast. Ändern kannst du das jederzeit unter Serienaufnahmen. |
| TV / phone hint | Change it later in Slipstream on your phone or computer | Ändern kannst du das später in Slipstream auf Handy oder Computer |
| Toast | Series recording added: {name} · {n} upcoming · [Undo] | Serienaufnahme angelegt: {name} · {n} geplant · [Rückgängig] |
| Toast, broadcasts | Series recording added: every “{name}” · {n} upcoming · [Undo] | Serienaufnahme angelegt: immer „{name}“ · {n} geplant · [Rückgängig] |
| TV toast | Series recording added | Serienaufnahme angelegt |
| Scheduled by | Scheduled · by your series recording {name} | Geplant · durch deine Serienaufnahme {name} |
| Upcoming line | {n} upcoming | {n} geplant |
| Offer line | Shows up in {n} places in Recordings · Group them… | Steht unter Aufnahmen an {n} Stellen · Zusammenfassen… |
| Recording detail | From series recording {name} | Aus der Serienaufnahme {name} |
| Editor sections | Conditions · Episodes | Bedingungen · Folgen |
| Episode choice | Only episodes you don't have yet · Every airing | Nur Folgen, die du noch nicht hast · Jede Ausstrahlung |
| Choice help | Doesn't record an episode you already have or have scheduled, on any channel or at any time. If a recording fails, the repeat is recorded instead. | Nimmt keine Folge auf, die du schon hast oder die schon geplant ist, egal auf welchem Sender oder wann. Schlägt eine Aufnahme fehl, wird stattdessen die Wiederholung aufgenommen. |
| Date-identified note | For live events and programmes without episode data, “don't have yet” goes by date: every new broadcast is recorded, only a marked repeat on the same or next day is left out. | Bei Live-Übertragungen und Sendungen ohne Folgenangaben zählt das Datum: Jede neue Übertragung wird aufgenommen, nur eine gekennzeichnete Wiederholung am selben oder nächsten Tag nicht. |
| History line | {n} deleted episodes won't be recorded again · Forget them | {n} gelöschte Folgen werden nicht erneut aufgenommen · Vergessen |
| History forgotten (toast) | Deleted episodes will be recorded again when they're repeated | Gelöschte Folgen werden bei Wiederholungen wieder aufgenommen |
| Guide mark label | already recorded · already scheduled | schon aufgenommen · schon geplant |
| Sheet badge | Already recorded · Already scheduled | Schon aufgenommen · Schon geplant |
| Sheet status | Already recorded {day}, {time} [on {channel}] · [Play it] | Schon aufgenommen: {day}, {time} [auf {channel}] · [Abspielen] |
| | Already scheduled {day}, {time} [on {channel}] · [Show it] | Schon geplant: {day}, {time} [auf {channel}] · [Anzeigen] |
| | You had this episode (recorded {day}). It was deleted. | Diese Folge hattest du schon (aufgenommen am {day}). Sie wurde gelöscht. |
| Button | Record anyway | Trotzdem aufnehmen |
| Toast | Recording {title} anyway | {title} wird trotzdem aufgenommen |
| Preview rows | Already recorded · {day}, {time} · Already scheduled · {day}, {time} | Schon aufgenommen am {day}, {time} · Schon geplant am {day}, {time} |
| Rerun, gaps | Recording had gaps. Recording the repeat on {day}, {time} instead. | Aufnahme lückenhaft. Stattdessen wird die Wiederholung am {day}, {time} aufgenommen. |
| Rerun, failed | Recording failed. Recording the repeat on {day}, {time} instead. | Aufnahme fehlgeschlagen. Stattdessen wird die Wiederholung am {day}, {time} aufgenommen. |
| Rerun, looking | No repeat in the guide yet. Slipstream keeps looking until {day}. | Noch keine Wiederholung im Programm. Slipstream sucht bis {day} weiter. |
| Rerun, none | No repeat found. | Keine Wiederholung gefunden. |
| Rerun, kept | Repeat recorded too | Wiederholung zusätzlich aufgenommen |
| Replaced (card) | {title} replaced by the repeat from {day} | {title} durch die Wiederholung vom {day} ersetzt |
| Repeat detail | Replaces the recording from {day}, which had gaps · Keep the original | Ersetzt die lückenhafte Aufnahme vom {day} · Original behalten |
| Protected original | Kept because it is protected | Behalten, weil sie geschützt ist |
| Conflict option | Record the repeat instead ({day}, {time}) | Stattdessen die Wiederholung aufnehmen ({day}, {time}) |
| Delete good episode | Delete · Delete, record it again when repeated · Deleted episodes aren't recorded again when they're repeated. | Löschen · Löschen, bei Wiederholung neu aufnehmen · Gelöschte Folgen werden bei Wiederholungen nicht erneut aufgenommen. |
| Delete damaged episode | Delete · Delete and stop looking for a repeat · Slipstream still records the repeat. | Löschen · Löschen und nicht mehr nach Wiederholung suchen · Slipstream nimmt die Wiederholung trotzdem auf. |
| Offer title | Group these as “{name}”? | Diese Aufnahmen als „{name}“ zusammenfassen? |
| Offer body | They have different titles, so they'd show up in {n} places in Recordings. A collection keeps them together, with matching recordings you make yourself. | Sie haben verschiedene Titel und stehen unter Aufnahmen an {n} Stellen. Eine Sammlung hält sie zusammen, auch passende, die du selbst aufnimmst. |
| Offer buttons (web) | Group them · No thanks | Zusammenfassen · Nein danke |
| Offer buttons (TV, phone) | Group them · Not now | Zusammenfassen · Jetzt nicht |
| Offer done (live region, toast) | Grouped as “{name}” · [Undo] | Als „{name}“ zusammengefasst · [Rückgängig] |
| Library card | Your series recording “{name}” records programmes with different titles, so they show up in {n} places. Keep them together? | Deine Serienaufnahme „{name}“ nimmt Sendungen mit verschiedenen Titeln auf, sie stehen an {n} Stellen. Zusammenfassen? |
| Goes to, scattered | Automatic (by title and date, {n} separate places) · Group them in a collection | Automatisch (nach Titel und Datum, {n} einzelne Stellen) · In einer Sammlung zusammenfassen |
| Goes to, leaving a linked collection | {collection} will keep today's conditions and stop following this series recording | {collection} behält die heutigen Bedingungen und folgt dieser Serienaufnahme nicht mehr |
| Linked notice (no collection permission) | Saving changes to the conditions stops “{collection}” following this series recording. The collection keeps today's conditions. | Wenn du die Bedingungen änderst, folgt „{collection}“ dieser Serienaufnahme nicht mehr. Die Sammlung behält die heutigen Bedingungen. |
| Linked collection | Follows the series recording “{name}” · Follows this series recording | Folgt der Serienaufnahme „{name}“ · Folgt dieser Serienaufnahme |
| Collection editor | Advanced: what belongs here · Use its own conditions instead · Later changes to the series recording no longer change this collection. | Erweitert: Was hier hineingehört · Stattdessen eigene Bedingungen verwenden · Spätere Änderungen an der Serienaufnahme ändern diese Sammlung dann nicht mehr. |
| Delete series | Delete the series recording “{name}”? · Scheduled recordings from it are removed. Recordings you have stay. · Keep the collection “{collection}” · Remove the collection (its recordings go back to automatic groups) | Serienaufnahme „{name}“ löschen? · Geplante Aufnahmen daraus werden entfernt. Vorhandene Aufnahmen bleiben. · Sammlung „{collection}“ behalten · Sammlung entfernen (ihre Aufnahmen kommen zurück in die automatische Gruppierung) |
| Kept collection toast | The collection {name} stays | Die Sammlung {name} bleibt |
| Upgrade notice (Home) | Series recordings now leave out episodes you already have · Review | Serienaufnahmen lassen jetzt Folgen aus, die du schon hast · Ansehen |
| Library view (de only) | Collections & shows | Sammlungen & Sendungen |

Other strings that say rule today change with the same words: Home onboarding ("Create your first
series recording" / "Leg deine erste Serienaufnahme an", CTA "Record a series" / "Serie
aufnehmen"), home badges and cards, the palette, keyboard-shortcut help ("Series options" /
"Serienaufnahme ändern"), the player's "by your series recording", auth tagline ("Let series
recordings record…" / "Serienaufnahmen nehmen für dich auf…"), Settings ("Every new series
recording…"), the library explainer (it no longer explains two concepts), and the near-miss
messages in `messages/status/*` ("Shorter than the series recording allows"). `grep -rn
"[Rr]ule\|Regel" packages/i18n/messages` must come back empty of user-facing text.

## 10. Build order and tests

The work is split into parallel packages (see the implementation plan of 2026-11-23): a contract
package first (domain, API, shared i18n, recorder ports, web API layer and mock), then server,
recorder, three web areas and the app in parallel. Tests that must exist when the work is done:

**Domain** (`packages/domain/test`):
- `episode.test.ts`: every row of §4.3; generic sub-titles (constant "Das Magazin" on 5 days with
  changing descriptions → Broadcast; a repeated Tatort with one description → Episode); the
  description guard; Event replay without a sub-title; next-day Event window; Tagesschau live/not
  live; Tatort as Fernsehfilm with a sub-title; `recordEveryKind` agrees with `episodeIdentity` for
  every fixture.
- Property tests (fast-check if present in the catalogue, otherwise a seeded generator):
  `sameEpisode` is reflexive for Episode and Film; symmetric for Episode and Film; no Event pair
  on non-adjacent local days matches; no Broadcast pair without an explicit marker matches.
- `rule.test.ts`: "does not treat the same title at another time as a duplicate" stays true for
  `findDuplicate`; a new block covers `planRecordings` with repeats (per-rule decisions, `replaces`
  annotation of an already planned airing, unserved copies, planned items matched against each
  other) and `findRepeatAiring` with the real `seriesRule()` matcher for the Tatort-on-ONE and
  F1-replay cases.
- `rerun.test.ts`: `rerunState` for every row of its table; chains with two attempts.
- `collection.test.ts`: `resolveCollections` (follows, missing rule → snapshot, never empty),
  `linkProblems`, `collectionOffer`, suggestions skip recordings covered by a series recording.

**Recorder** (`packages/recorder/test`, memory adapters): fail → repeat planned → good → replaced
(hidden, 7-day purge); repeat shorter than 90 % → both kept; repeat also fails → second try →
exhausted; 14-day expiry; planned repeat removed by a guide change → back to looking; replan twice
gives the same plan; nudge after finish without a deadlock on the tick lock; conflict pass 2
picks the served airing; retention never deletes a looking chain and counts a chain once;
retention writes history only for good recordings.

**Server** (`apps/server/test`): migration linking fixture; linked collection after rule delete
(keep/remove) and after user delete; invariant on *Goes to* change; non-admin linked edit unlinks;
offer decline; history count/forget; delete with `history=skip` / `rerun=stop`; keep-original;
`/guide/repeats` filtered by access; record-options `Owned` vs `Repeat`; undo window; old-client
PATCH keeps `skipRepeats`.

**Web unit + e2e**: programme sheet kinds, `Owned`/`Repeat` states and the offer line; editor
Episodes section and history line; collection editor Advanced and linked line; e2e journeys
*Record every from the programme sheet*, *the collection offer* (Group them, Undo), *Repeat state
in the programme sheet* (Record anyway), and *the renamed navigation* (Series on every breakpoint,
`/rules` redirects, `G` `E`); layout-shift sweep includes `/series` and `/series/$id`.

**App**: record-options kinds, offer step *Not now* does not decline, repeat state, phone
long-press opens the sheet.

## 11. Review log (2026-11-23)

Every critical and major point of the UX review (7/10) and the engineering review (6.5/10) is
resolved above; minor points are resolved too unless listed as not done.

| Point | Resolution |
| --- | --- |
| Fallback cannot find the F1 replay / Tatort on ONE (critical, both) | §3.7 `findRepeatAiring` by episode identity, ignoring the matcher; §4.1 show key check; §4.3 rows; tests §10 |
| Generic sub-titles put a show into Episode (critical) | §4.1 identifying sub-titles, `genericSubtitles`; §4.2 description guard; §4.3 rows |
| Live → not-live inference skips news (major) | §4.2: Event only, with the 20 % length test; Broadcast explicit signals only; Tagesschau row |
| Persisted `looking`/`scheduled` (major) | §3.7 derived state, only terminal outcomes + `rerunUntil` + `rerunAttempts` stored; chain to the original |
| Replacement may delete a better recording (major, both minors) | §3.7 steps 3–4: 90 % length and fewer missing seconds, hidden 7 days, *Keep the original* |
| Empty linked matcher fails open (major) | §3.4 tagged `StoredCollection`, snapshot, `on delete restrict` |
| Two-way link invariant (major) | §3.4 invariant and enforcement points |
| Non-admin changes a household collection (major) | §3.4 access: unlink on save, notice in §3.2 |
| Repeat selection ignores conflicts (major) | §5.2 two-pass planning with `unserved` |
| Retention vs rerun (major) | §5.4; deleting damaged recordings never writes history (§3.6) |
| Film-category series hides Record series (major) | §3.1 `recordEveryKind` derived from `episodeIdentity`; Episode before Film |
| Deleting a failed recording cancels the re-record (major) | §3.6, §3.7 step 7: plain *Delete* keeps looking; *Delete and stop looking for a repeat* |
| History invisible (major) | §3.2 history line + *Forget them*, `DELETE /rules/:id/history` |
| Negative "Skip repeats" switch (major) | Two-option radio *Only episodes you don't have yet* / *Every airing*; field stays `skipRepeats` |
| Two ways to a collection in the sheet (major) | §3.1: Goes to only with collections or More options; no *New collection…* in the sheet |
| Two library suggestions overlap (major) | §3.3: series-covered recordings never feed the generic suggestion |
| Doc and SPEC disagree on Record series for a repeat (major) | §3.1 table `Owned` vs `Repeat`, the same in SPEC §8.3 |
| No series recording from the phone (major) | §3.1 phone long-press / ⋯ opens the RecordSheet |
| TV *No thanks* permanent (major) | §3.1 *Not now* never declines; Undo toast after *Group them* |
| Test plan too thin (major) | §10 |
| Undo leaves an orphaned collection; Undo does not revert owners (minor) | §3.1 Undo, `addedByRuleId` (§5.3) |
| Silent behaviour change on upgrade (minor) | §3.6 upgrade notice |
| Busy Record button (minor) | §3.1 1.5 s cap, offer in a reserved status line |
| "Edit series" ambiguous (minor) | *Series options / Serienaufnahme ändern*; broadcasts toast teaches the word |
| TV hint "on the web" (minor) | "on your phone or computer" |
| German copy (minor) | §9 rows updated as proposed |
| "Skip" means two things (minor) | §1 naming; results named *Already recorded / scheduled* |
| Skipped-airing state only for own series (minor) | `Owned` status and guide mark for any visible copy |
| Event sub-title and window (minor) | §4.2 sub-titles only when both present; same or next local day |
| Older clients reset fields (minor) | §7 `RuleUpdate` omitted = keep; `offerDeclined` read-only with its own action |
| Per-rule skip decisions (minor) | §3.6 decided per (rule, airing) |
| 48 h horizon (minor) | §3.7 step 2: 8 days; §5.2 cache invalidation |
| Linear findRepeat (minor) | §4.2 `episodeIndex` |
| Destructive migration (minor) | §6 equality defined, snapshot keeps the matcher, transactional, fixture test |
| TV Series list | Not in this build: the TV rail gets *Series* together with the list; until then the TV hint points to phone or computer |
