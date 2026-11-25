# Slipstream web: final direction (implementation blueprint)

Prototype: `docs/design/web-v2/final/index.html` (open it via `file://`). The prototype is the
visual and behavioural reference; this document is the contract for rebuilding `apps/web` in
React 19 + Tailwind v4 + shadcn on Base UI + TanStack Router/Query + hls.js.

The recording model (series recordings, optional and linked collections, which episodes to record, the
repeat fallback) is specified in `docs/design/recording-model.md` (2026-11-23); it wins over
the prototype's *Rules* wording. In code and the API the series recording is still `Rule`.

Base: direction A "Cinema". Grafts: B "Precision" (programme bands on the timeline, the
"playing · live" line, plain-language rule summary, keyboard-first guide, `Now`/`20:15` jumps),
C "Timeline" (amber gap band, rule save bar that states its effect, warm-paper light theme),
D "Pocket" (navigation per breakpoint with a labelled tablet rail, mini player, server status,
time-slot chips with meaning, "No guide data · Watch live" rows, one sheet pattern).

Prototype states (avatar menu › Prototype states…): all five Home hero states, slow network
(skeletons), empty library, connection lost, no problems, setup, sign-in, TV approval, player
error.

---

## 1. Principles

1. **Live TV that waits for you is the first thing on every screen.** What is recording, how far
   you are behind live, and the way back to live are never more than one tap away (hero, mini
   player, choice dialog, player).
2. **Artwork leads, chrome recedes.** Never a grey box: guide image › frame from the recording ›
   generated artwork (§7.4).
3. **Nothing moves unless you moved it.** No layout shift on load, hover, opening panels, toggling
   states or switching hero content (§6). Tested: 0 elements moved between skeleton and loaded on
   9 routes at 1440 and 390 px; identical hero height, title line and actions in all 5 states; scrub hover changes only the
   absolutely positioned tooltip and marker.
4. **One control height per row.** Controls come from a three-step height scale (§3.5).
5. **Don't guess when it already started.** Anything that started before you opened it asks
   Resume / From start / Live (§7.6) instead of picking for you.
6. **Plain language, the fix next to the problem.** "No free stream for watching. Both watching
   streams are in use…" with "Stop arte on Kitchen Shield". Titles are statements, never questions.
7. **Every word comes from `packages/i18n`** (English source, German first translation). Copy in
   the prototype is the English source text.

---

## 2. Layout system

### 2.1 Breakpoints

| Name | Range | Navigation | Gutter |
| --- | --- | --- | --- |
| `phone` | < 600 | bottom tab bar (5 tabs, 64 px + safe area) | 16 |
| `phablet` | 600–767 | bottom tab bar | 24 |
| `tablet` | 768–1099 | left rail, 84 px, icon + label, logo mark on top | 24 |
| `desktop` | 1100–1399 | top bar 64 px: lockup, tabs (Home, Guide, Recordings, Series), recording pill, ⌘K search, settings, avatar | 40 |
| `wide` | ≥ 1400 | same as desktop | 56 |

Tailwind v4: define `--breakpoint-sm: 600px; --breakpoint-md: 768px; --breakpoint-lg: 1100px;
--breakpoint-xl: 1400px` in `@theme`. Never use other breakpoints. The player has two extra
modes: phone portrait (`max-width: 767px and orientation: portrait`: picture on top, controls
stacked below) and short landscape (`max-height: 520px and orientation: landscape`: overlay,
compact, no bands).

### 2.2 App shell

```
<SkipLink/>                      first tab stop, "Skip to content"
<Rail/>          tablet only     fixed, left, width var(--rail-w) = 84px
<TopBar/>        always (not in player/auth)  fixed, height var(--nav-h) = 56 / 64 (≥1100), left: var(--rail-w)
<OfflineBanner/> fixed overlay strip under the top bar (z 39, glass shadow); never in flow, so it moves nothing
<main>           padding-top: nav-h + safe-area; padding-left: rail-w;
                 padding-bottom: tab-h + mini-h + safe-area + 24 (phone) / 64 + mini-h (≥768)
<MiniPlayer/>    fixed; phone: above tab bar, full width - 16; ≥768: bottom-right, 380 wide (300 × 48 in short
                 landscape, no Live button there so the readout stays whole); bottom offsets add safe-area-inset-bottom
<TabBar/>        phone only
<Toaster/>       phone: centred above tab bar + mini + save bar; ≥768: bottom-right above the mini player
                 (bottom: 24 + --mini-h + --save-h); left of an open side sheet; player: top-centre;
                 at most 3 toasts, at most 1 in short landscape
```

- Content width: `.wrap` = `max-width: 1520px; margin-inline: auto; padding-inline: var(--gutter)`.
  The guide grid and media rows bleed to the gutter edge.
- Home sets `under`: the hero runs under a transparent top bar (`.topbar.over`) until scroll > 40.
- Routes with `full` (player, setup, sign-in, TV approval) hide rail, top bar, tab bar and mini
  player.
- `--mini-h` is 64 px only on routes that render the mini player; it is decided at render time of
  the route, so the reserved space never toggles inside a page. The mini player is **not** rendered
  on editor routes (series recording, collection: the save bar owns the bottom edge), on the recording detail of
  the same item, on Home while **any** of the hero's items is the same recording (every switcher tab
  counts, and the idle hero's item too, so switching hero tabs never adds or removes it), or on the
  guide in short landscape (the grid owns the whole screen there). From 768 px `main` reserves
  `32 px + --mini-h` at the bottom; on phones `--tab-h + --mini-h + 24 px`. `--save-h` (64 px) is set on
  editor routes below 1100 px so toasts stack above the save bar.
- The save bar is `fixed` beside the rail (`left: var(--rail-w)`) below 1100 px and `sticky` at the
  bottom of the form column (glass card) from 1100 px. It always shows the effect ("6 will record ·
  not saved yet"); on phones the rule editor puts the count into its "Preview · 6" jump link.

### 2.3 Grids

| Pattern | phone | ≥600 | ≥1100 | ≥1500 |
| --- | --- | --- | --- | --- |
| Media row (horizontal, snap, peek) | 1.35 cards | 2.3 | 4 | 5 |
| Tiles (library, collections) | 2 | 2 (3 at ≥768) | 4 at ≥1280 | 5 |
| Sessions in an event | 2 | 3 at ≥768 | 5 at ≥1280 | 5 |
| Attention cards | 1 col | auto-fit 320 min at ≥768 | | |
| Editors (rule, collection) | stacked | stacked | form + sticky preview 380–460 | |
| Settings | horizontal pill nav + content | | 220 px nav + content | |
| Recording detail | stacked | stacked | 1.25fr / 1fr, side sticky | |

Row gaps: 12 (phone) / 16 / 20. Section rhythm: `section + section = 40px`, section head 32 px
min-height, 14 px below.

### 2.4 Navigation per breakpoint

- **Phone tab bar:** Home, Guide, Recordings, Series, Settings (the same five words as the rail and
  the top bar; German: Start, Programm, Aufnahmen, Serien, Einstellungen). *Series* is the short
  form of *Series recordings* (page title, palette, sentences), see recording-model.md §1. Problems badge on Recordings. Search sits in the top bar (icon), avatar in the top
  bar.
- **Tablet rail:** same five items with labels (never icon-only); logo mark at the top.
- **Desktop top bar:** four tabs; Settings is an icon button (gear, not sliders); recording pill
  "Recording" (one: opens its choice dialog) or "Recording · 2" (a menu listing every running
  recording with channel, since and owner; picking one opens its choice dialog); ⌘K search field
  260 px with `⌘K` hint. While the bar is transparent over the hero (`.over`) it uses the cine focus
  colour (`--focus: #FFC233`), in both themes.
- **Avatar menu (all sizes):** current profile, *Switch profile* (household profiles, lock icon for
  PIN), Settings, Profiles/guests/devices (admin only), Keyboard shortcuts (fine pointer only),
  Theme (system/light/dark), Sign out. Profile rows and items share one row height (40, 44 coarse)
  and one 20 px icon column. Arrow keys move through profile rows and items alike. On desktop it is
  a Base UI Menu: capped at the space available (`max-height`, scrolls), never covers its trigger,
  closes on Tab and Esc.
- **Menu → Sheet under 768 px on coarse pointers.** The avatar menu, the guide's Filter and the
  guide's day picker render their items inside the **same Sheet primitive as the programme sheet**
  (Base UI Dialog + Vaul-style drawer): grab handle with drag to dismiss, `?dlg=account|filter|day`
  in the URL so back closes it, background `inert`, focus trap, focus on the first item (the checked
  one for radio menus), focus returns to the trigger. There is exactly one bottom-sheet behaviour in
  the app.

---

## 3. Design tokens

All tokens live in `packages/design-tokens` (source of truth) and are generated to CSS variables
for Tailwind v4 (`@theme inline` maps utilities to the variables) and to the React Native theme.
Components never use raw colours. Names below are the CSS variables.

### 3.1 Colour: semantic, both themes

| Token | Dark (default) | Light (warm paper) | Use |
| --- | --- | --- | --- |
| `--bg` | `#0A0A0C` | `#F5F4F0` | page |
| `--bg-2` | `#0F0F12` | `#FFFFFF` | inputs, rail, sheets |
| `--surface` | `#151518` | `#FFFFFF` | panels, cards, guide grid |
| `--raised` | `#1C1C21` | `#EEEDE8` | guide cells, pressed surfaces |
| `--sunken` | `#08080A` | `#ECEBE6` | wells |
| `--hover` / `--press` | `rgba(255,255,255,.055/.09)` | `rgba(20,20,22,.045/.08)` | interaction fills |
| `--line` / `--line-2` | `rgba(255,255,255,.075/.14)` | `rgba(20,20,22,.09/.16)` | hairlines, control outlines |
| `--fg` | `#F3F2EE` | `#131315` | primary text |
| `--fg-2` | `#B2B1AB` | `#4F4E4A` | secondary text (AA on bg) |
| `--fg-3` | `#84837E` | `#6E6D68` | meta (AA large / UI) |
| `--fg-4` | `#5E5D59` | `#9A9993` | decoration only, never text |
| `--brand` | `#FFC233` | `#FFC233` | fills: primary button, playhead, focus (dark) |
| `--brand-fg` | `#FFC233` | `#8A5E00` | amber text |
| `--brand-soft` | `rgba(255,194,51,.14)` | `rgba(255,194,51,.22)` | selected, suggestions |
| `--on-brand` | `#1A1300` | `#1A1300` | text on amber |
| `--live` | `#FF3D52` | `#E0243A` | live, recording, now line |
| `--live-fg` / `--live-soft` | `#FF6B7B` / `.14` | `#C1132A` / `.10` | |
| `--warn` / `--warn-fg` / `--warn-soft` | `#FF8A3D` / `#FF9F5E` / `.13` | `#C25300` / `#A84700` / `.10` | conflicts, incomplete |
| `--on-warn` | `#1A0E05` | `#FFFFFF` | text on a `--warn` fill (nav problem count: 8:1 dark, 5.1:1 light) |
| `--warn-ink` | `#FF9F5E` | `#8A3A00` | Warn badge text (≥ 5.9:1 on the orange-tinted conflict row in light) |
| `--ok` / `--ok-soft` | `#3DD68C` / `.12` | `#0E8A55` / `.10` | healthy fills (switch, dots) |
| `--ok-fg` | `#3DD68C` | `#0B7347` | green **text** (badges, "Will record", marked words): 5.9:1 on white |
| `--live-solid` | `#D7263D` | `#C8102E` | fills that carry white text (Rec/Live badges, now chip, Delete): ≥ 4.9:1 |
| `--info` | `#8AB4FF` | `#8AB4FF` | layout part 1 in editors |
| `--focus` | `#FFC233` | `#131315` | focus ring |
| `--glass` / `--nav-bg` | `rgba(22,22,26,.72)` / `rgba(10,10,12,.78)` | `rgba(255,255,255,.78)` / `rgba(245,244,240,.82)` | top bar, tab bar |
| `--sk` / `--sk-hi` | `rgba(255,255,255,.065/.12)` | `rgba(20,20,22,.06/.10)` | skeleton fill / shimmer |
| `--tl-track` / `--tl-cap` / `--tl-played` | `.12` / `.34` / `#F3F2EE` | `.10` / `.32` / `#131315` | timeline |

**`.cine` scope** (always dark, whatever the theme): the player, the Home hero, the mini player,
dialogs opened from the player. It redefines `--bg #050506`, `--fg #F6F5F1`, `--fg-2 #C4C3BD`,
`--fg-3 #95948E`, `--brand-fg #FFC233`, `--live-fg #FF7080`, `--focus #FFC233`. Implement as a
`data-surface="cine"` attribute that re-declares the variables, so Tailwind utilities keep working.

Theme switching: `:root` = dark; `@media (prefers-color-scheme: light) :root:not([data-theme=dark])`
= light; `:root[data-theme=light]` = light; `[data-theme=dark]` forces dark. Theme choice in
`localStorage` (`ss-theme`), applied before first paint by an inline script in `index.html`.
`<meta name="theme-color">` per scheme.

Meaning rule: **amber = you** (your position, your gap to live, the primary action, focus in dark,
the selected-tab bar); **red = live / recording / now**; orange = attention; green = healthy / will
record. The offline banner is therefore a neutral glass strip with an orange wifi icon, never red. A live
programme you have no position in shows only the red live edge, never the amber knob; neutral facts
("Next at 19:25, in 43 min") are `--fg`, not amber.

### 3.2 Type

Faces: **Inter Tight** (display, headings: 500–800), **Inter** (UI: 400–700, `cv11`, `ss01`).
Tabular figures (`font-variant-numeric: tabular-nums`) on every time, duration and counter. No
monospace in the UI except paths/templates. Artwork-only faces: **Anton** (sport), **DM Serif
Display** (crime, film), **Fredoka** (kids), loaded in a separate stylesheet so UI text never waits
for them. Self-host all of them with `@fontsource` (replace Geist, Geist Mono and Big Shoulders).

| Role | Size / line | Weight | Tracking |
| --- | --- | --- | --- |
| `display` (hero title) | clamp(32px, 5vw, 64px) / 1 | 750 | -0.04em |
| `h1` (page) | clamp(26px, 3vw, 34px) / 1.1 | 700 | -0.03em |
| `h2` (section) | 20 / 1.2 | 650 | -0.02em |
| `h3` | 16 / 1.3 | 600 | -0.01em |
| `body` | 15 / 1.5 | 400 | 0 |
| `label` | 13–14 / 1.3 | 600 | 0 |
| `meta` | 13 / 1.4 | 400 | 0 |
| `caption` (timeline labels) | 12 / 16 | 600 | 0 |
| `eyebrow` | 12 / 1 | 600, uppercase | 0.06em |
| player readout | 36 (26 short landscape) / 1 | 700 Inter Tight | -0.03em |

Minimum text size 12 px. Meta text uses `--fg-2` on surfaces; `--fg-3` only for 12–13 px labels
that meet 4.5:1 on their actual background (verify in `contrast.test.ts`).

### 3.3 Spacing, radii, elevation

- Spacing scale (px): 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56, 64. Map to Tailwind's
  4 px base; the 2/6/10/14 steps are `0.5/1.5/2.5/3.5`.
- Radii: `--r-s 8` (chips in cards, logos), `--r-m 12` (cards, inputs, art), `--r-l 18` (panels),
  `--r-xl 24` (sheets, dialogs), `999px` for buttons, chips, segmented controls.
- Elevation: dark mode separates surfaces with 1 px hairlines (`inset 0 0 0 1px var(--line)`), not
  shadows. `--shadow-pop` for floating layers only (menus, sheets, dialogs, mini player, toasts):
  dark `0 24px 64px -12px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.08)`; light
  `0 24px 64px -16px rgba(20,20,22,.28), 0 0 0 1px rgba(20,20,22,.08)`.
- z-index: content 0–5, guide sticky 3–4, top bar/rail/tab bar 40, mini player 42, sheet/dialog
  overlay 70/71, menu 80, toast 90.

### 3.4 Motion

| Token | Value | Use |
| --- | --- | --- |
| `--ease` | `cubic-bezier(.2,.8,.2,1)` | everything |
| `--t-fast` | 140 ms | hover, press, colour |
| `--t-med` | 260 ms | panels, chrome, fades |
| `--t-slow` | 320 ms | sheets |

Dialogs and sheets leave with the same motion they enter with (Base UI `data-ending-style`;
dialog 200 ms fade + scale, removed after `--t-slow` 320 ms; sheet 320 ms slide); menus leave in
`--t-fast` (opacity, about 150 ms). Only replacing one overlay with another is instant. The
`data-starting-style` / `data-ending-style` CSS uses these tokens and nothing else.
Animate only `opacity`, `transform`, `background-color`, `color`, `box-shadow`; never `all`,
never width/height/top/left. Live pulse 1.6 s, live-edge ring 2 s. Player chrome idles out after
3 s. `prefers-reduced-motion`: all durations → 0.001 ms, no Ken-Burns, no ring.

### 3.5 Control height scale

| Token | Value | Used by |
| --- | --- | --- |
| `--ctl-sm` | 32 px (40 px under `pointer: coarse`, plus an invisible `::before` hit area to 44+) | buttons/steppers inside cards, table rows, dense lists |
| `--ctl-md` | 40 px (44 px under `pointer: coarse`) | default: buttons, icon buttons, chips, segmented controls, inputs, selects, search fields, player controls |
| `--ctl-lg` | 48 px | hero CTAs, auth CTAs, player play button, detail page primary actions |

Rule: all controls in one row (a `Toolbar`) use the same step. The recordings toolbar (search,
segmented control, filter chips) is `md` throughout. A segmented control is `md` outside with
32 px inner pills (3 px padding). Tailwind: `h-ctl-sm|md|lg` utilities from the tokens.

---

## 4. Component inventory

Base UI primitive in brackets; shadcn styling replaced by these specs.

| Component | Variants | States / notes |
| --- | --- | --- |
| **Button** [Button] | primary (amber), secondary (hover fill + line-2 outline), glass (on cine), ghost, danger, live (red); sizes sm/md/lg | hover, active scale .97, focus-visible ring, disabled .45, busy (spinner replaces label, width kept) |
| **IconButton** | sm/md/lg, `outline`, `aria-pressed` | tooltip (`data-tip`) on hover/focus, never on touch |
| **Chip** | md, sm; toggle (`aria-pressed`) with optional count | |
| **Segmented** [ToggleGroup] | md | `role=group`, pressed = surface pill |
| **Toolbar** | — | flex, gap 10, wrap; children share one height |
| **Input / Select / Search** | md; search has leading icon | hover outline, focus 2 px amber inset, error red inset + message with icon |
| **Tokens input** | channels, title words | Enter adds, Backspace removes last, × per token |
| **Stepper** | sm; minutes or count | output is tabular |
| **Switch** [Switch], **Checkbox** [Checkbox], **Radio rows** [RadioGroup] | | |
| **Badge** | live (solid red, pulse), rec (soft red, pulse), sched (amber soft), warn (`--warn-ink`), ok, neutral, glass | 22 px; zero counts are neutral, never ok-green |
| **Tooltip** [Tooltip] | above / below / left | only `(hover:hover)`; 250 ms delay |
| **Menu** [Menu] | radio items, checkbox items, section headers | arrow keys, Tab and Esc close it, Esc returns focus to trigger; **under 768 px on coarse pointers a menu becomes a Sheet** (§2.4) |
| **Sheet** [Dialog + Vaul-style drawer] | side drawer ≥768 (460 wide, inset 8, header row 60 px with context + close; 48 px and an 88 px art band in short landscape); bottom sheet < 768 (grab handle, no close button, max `100dvh − safe-top − 24`; in landscape a centred column of max 560 px with the art capped at 40dvh and no half snap) | decided by CSS breakpoints, never once in JS; modal: focus trap, scroll lock, background `inert`, Esc, focus returns to opener; URL-addressable (§11); sticky footer with **one primary**, every footer control `lg` |
| **Dialog** [Dialog] | md 640, sm 460; `sm` becomes a bottom sheet under 600 px (grab handle, drag to dismiss); invite and prototype states are `sm` | same modal rules; ⌘K palette is a Dialog; `max-height: 100dvh − top − safe-bottom − 16` with a scrolling body and a sticky action footer (`dfoot`); top 8 px in short landscape |
| **Toast** | success, recording, error; with Undo | 4.2 s; max 3; never over player controls |
| **Command palette** [Combobox in Dialog] | groups: Actions, Channels, In the guide, Recordings, Series recordings | input `role=combobox` + `aria-activedescendant`, options `role=option` with ids; ↑↓ Enter Esc; focus returns; results filtered by the profile's access |
| **Artwork** | 16:9 (default), 2:3, 1:1; source guide / frame / generated from **one resolver** (§7.4); `notitle` inside sheets and the player | always fixed aspect ratio (§6) |
| **SourceBadge** | on artwork (hero poster, recording detail) | own scoped component (24 px pill, inline-flex, icon + label on one line); never a global class name |
| **ChannelLogo** | sm 32×24, md 44×32, lg 56×40 | channel colour fallback with short mark; decorative (`aria-hidden`), the channel name is always next to it or in the label |
| **MediaCard** | recording, live, scheduled, collection tile (stacked) | hover lifts art 2 px + play glyph; focus ring on art; progress bar (amber watched, red live); badges top-left |
| **MediaRow** | | horizontal scroll-snap, arrow buttons on hover ≥1100, keyboard scrollable |
| **Timeline** | full, compact; interactive | see §5 |
| **BehindReadout** | player, hero line, mini | `−31:30 behind live`, sub line `playing 18:11:30 · live 18:42 [· 1.25× · live at 19:02]`; the ETA shows only while it falls inside the recording window; at live a 0.5 em pulsing dot + `LIVE` |
| **WatchChoice** | | §7.6 |
| **Hero** | 5 states | §8.1 |
| **HeroSwitcher** [Tabs] | | its own slot at the top of the hero; label "Recording now · 2" + equal tabs (`flex: 1 1 0`, max 300) with logo, title, owner avatar (+ name ≥ 600), since, live progress (≥ 600); under 600 px label above, tabs 50/50 (thirds for 3, scroll only from 4). **Selected** = `--raised` fill + `--line-2` hairline + `--fg` title + 2 px amber bar on the bottom inner edge; **unselected** = transparent + `--line` hairline + `--fg-2` title (≥ 3:1 non-text contrast between them) |
| **MiniPlayer** | live recording, finished recording | art, title, `−31:30 behind live`, Resume, Live, close; gap bar |
| **IssueCard** | err, warn | icon, title, explanation, actions, dismiss with Undo |
| **ProgrammeSheet** | live now (with/without recording), scheduled, recording now, ended, future | §8.3 |
| **GuideGrid**, **ChannelList**, **ChannelStrips** | | §8.2 |
| **RulePreview** | will record / similar, won't record (with reason, marked words) | |
| **CollectionEditor** | | §8.5 |
| **Skeleton** | — | not a component: a `data-loading` state on real components (§6.2) |
| **EmptyState**, **ErrorState** | | illustration, one sentence, primary fix |

---

## 5. The timeline (core component)

One component, `<Timeline>`, used in the hero, programme sheet, watch-choice dialog, player
(desktop overlay and phone stack), recording detail (gaps), and the mini player (as a 2 px bar).

Data (keep `modules/timeline/geometry.ts`, extend it): `start`, `end` (window incl. extra time),
`captured`, `gaps[]`, `marks[]` (programme ticks), `playhead`, `live`, plus new `bands[]`
(`{start, end, title}` from the guide for every programme inside the window).

Drawing, bottom to top:
1. track: **flat** `--tl-track` for what already aired (captured or not), **dashed** only from the
   live edge (or the `now` marker) to the end = not aired yet. Finished recordings have no dashes;
2. captured range (`--tl-cap`), drawn over the flat track (never over dashes);
3. played range from captured start to playhead (`--tl-played`);
4. **gap band** from playhead to live edge, amber gradient (`.7 → .28` alpha): this is "you are
   behind";
5. holes (source outages) hatched red, `title="Gap 04:12–04:14"`;
6. programme ticks **above** the track (6 px, 3 px gap), so they never cut through the bottom time
   labels;
7. live edge: red 12 px dot with a 2 s ring; a timeline without a live recording but with a channel
   that is on air (hero *Starts soon*) gets a still red `now` dot and a `Now 18:42` top label;
8. playhead: 16 px amber knob, only when there is a position that is yours (`noph` otherwise: a
   live programme you aren't watching shows just the red live edge).

Rows (all reserved, never collapsing): top labels 20 px (`● LIVE 18:42` in red at the edge, your
time in amber at the playhead, hidden when < 14 % apart), bands 16 px (only `has-bands`: current
programme in `--fg`, others `--fg-3`, ellipsis; a band narrower than ~48 px shows only its divider,
the tooltip still names it — container query on the band), track 6 px, bottom labels 18 px (window start
and end, or `0:00` / duration for finished recordings).

Interaction (player only):
- The **whole bar** is the slider: `role="slider"`, `tabindex=0`, `aria-valuetext` like
  `18:11, 31:30 behind live`. Hit area ±16 px around the track (±22 under coarse pointer). Pointer
  capture for drag.
- Hover: the track scales visually (`transform: scaleY(1.6)`), the knob counter-scales; the hover
  marker and tooltip (`18:30 · −12:00 · Qualifying`) are absolutely positioned. Within 60 s of the
  live edge the tooltip says `18:42 · Live · Qualifying`; past the live edge it says `Not aired yet ·
  19:28` on a dimmed fill, so the text always matches the marker. **No layout
  property changes on hover.** (Verified: only `.hoverpos` and `.tip` boxes change.) Hover effects
  live inside `@media (hover: hover)`; on touch the tooltip shows only while dragging, so it never
  sticks after a tap.
- Compact timelines (sheet, choice dialog) put their caption ("Started 42 min ago · 48 min left") on
  its own row 8 px below the bottom labels.
- Keys: ←/→ ±10 s, Shift+←/→ and PgUp/PgDn ±60 s, Home = from start of the programme, End = live.
- Trickplay thumbnails above the tooltip are PLAN "later"; reserve no space for them now.

---

## 6. Layout-shift rules (enforced in review and in an e2e test)

### 6.1 Reserved geometry
- Every artwork has an `aspect-ratio` (16/9 default) and `object-fit: cover`; images fade in over
  the generated artwork, which is the placeholder (same box).
- Text slots that change (behind readout, sub line, hero read line, counts) have `min-width` in
  `ch` or `min-height`, tabular figures, and are single-line with ellipsis.
- Buttons that come and go inside a row toggle `visibility`, not `display` (e.g. "Go live" at live).
- **Hidden by opacity means hidden from the tab order:** anything faded out (the player's big play
  button while playing, the panel) also gets `visibility: hidden` (with a delayed visibility
  transition so the fade still shows) or `inert`. Never a focusable control at opacity 0.
  The readout's delta has a fixed 1 em box, so "−31:30" and "● LIVE" are the same height (verified:
  readout row 62 → 62 px on reaching live).
- Hero: fixed height per breakpoint (`480` phone / `540` 600–1099 / `clamp(560px, 62vh, 660px)`
  ≥1100 / `max(360px, 100dvh)` in short landscape), content anchored to the bottom with a hard top
  floor (`padding-top: nav-h + safe-top + 16`) and `safe-area-inset-bottom` added at the bottom.
  Every slot has a fixed size: badges 22, eyebrow one line, **title line box `1.04em` of the display
  size** (long titles step down inside it, 64 → 51 → 40 px by length > 16 / > 24 characters; phone
  34 → 29 → 23 by length > 20 / > 24; ellipsis only after that), description 2 lines `min-height:
  3em`, **read line + timeline (or onboarding steps) in one 102 px slot** (82 in short landscape),
  bottom-aligned so the read line sits on its timeline and any spare space is above it, then
  actions. The switcher has its **own slot at the top**. Verified: title line top and actions top
  identical in all five states at 1440 (225 / 480), 2560, 1024, 390 and 844×390; height identical.
- The hero poster (≥ 1100) sits in the **same max-width grid** as the text (`640px | 1fr`, gap 56):
  its top is the badges' top and its bottom the actions' bottom in every state, and it never leaves
  the centred column at 1600 or 2560.
- The offline banner is an overlay strip (verified: `.wrap` top 64 → 64 px when it appears).
- Sheets, dialogs, menus, toasts, the player panel and the mini player are overlays (fixed/absolute).
  The player panel never resizes the picture (verified).
- `html { scrollbar-gutter: stable; }` so opening a modal (scroll lock) or a short page never
  shifts horizontally.
- Hover effects use transform/opacity/colour only.
- Badges and counts that can appear in nav items reserve their slot.

### 6.2 Skeleton contract
- Loading is a state of the **real** component tree: `data-loading` on the route container; every
  text node that comes from data is wrapped in a `<Sk>` span that, while loading, renders the
  placeholder text from the cached shape (or a fixed-length string) as transparent text on a
  `--sk` fill with shimmer. Artwork shows `--sk`. **Every** link, button, input and `[tabindex]`
  inside the loading route gets `pointer-events: none` (cards, dismiss, hero tabs, row arrows).
- Lists render their expected count while loading (from the previous response or a per-route
  default: guide = channel count, rows = 5 cards).
- TanStack Query: `placeholderData: keepPreviousData` for filters; route `pendingMs: 0` with the
  skeleton as the pending component that renders the same layout component.
- Never render a spinner in place of content. Spinners only inside busy buttons.
- Everything that comes from data is a skeleton, controls included: hero CTAs, switcher titles and
  their progress bars and owner avatars, card badges, issue-card actions ("Resolve", "Show log")
  and the artwork source badge render as skeleton boxes, not real text next to placeholder titles.
- After load only the data nodes fade in (`.sk`, `.sk-art`), never the chrome around them.
- Nothing from the data shows through while loading: `text-overflow: clip` inside the loading
  route (no ellipsis glyph at the end of a bar), state rows render their neutral variant (no
  conflict tint or border), and selection marks from data (the hero tab's amber bar and raised
  fill) are neutral until the data arrives.
- Loading belongs to the route that started it. In the prototype a route token guards it; in
  React derive `data-loading` from that route's query state, never from a class on a shared
  container (a fast second navigation must not inherit the first route's skeleton).
- Test (Playwright): record every visible element's box 80 ms after navigation and again after
  load; they must be identical, and no control may accept pointer events while `aria-busy`. The
  prototype passes on Home, Guide, Recordings, Scheduled, Collection, Recording detail, Rules, Rule
  editor, Users at 1440 and 390 px (0 moved, 0 clickable while loading).

### 6.3 Fonts
- Self-host Inter, Inter Tight (woff2, latin + latin-ext subsets), `font-display: swap`, with
  `@font-face` fallbacks using `size-adjust`/`ascent-override` metrics for Arial so swap does not
  reflow. Preload Inter 400/600 and Inter Tight 700.
- Artwork faces load with `font-display: optional`; generated artwork tolerates the fallback.
- The first data-driven paint waits for `document.fonts.ready` (max 300 ms) behind the skeleton.

---

## 7. Behaviour specifications

### 7.1 Player
- **Fills the viewport.** `position: fixed; inset: 0`. Default **Fill** (cover, no black bars);
  **Fit** shows the whole picture (letterbox). Portrait viewports (aspect < 1.3) always fit. Toggle:
  button + `Z`. The choice is remembered per device (`localStorage ss-player.fit`).
- **Fullscreen API** on the player element: button + `F`; icon reflects `fullscreenchange`.
  Esc in fullscreen exits fullscreen only; Esc otherwise closes panel → closes player.
- **Phone portrait** has a full-screen button on the picture (bottom-right, 44 px, glass): it
  requests full screen and then `screen.orientation.lock("landscape")` where allowed; on iOS Safari
  it calls the video element's `webkitEnterFullscreen()`. This is the route to "the player fills
  the screen" from the default phone layout.
- No channel watermark over the picture (it read as a label for the panel button).
- **Picture in the reference:** the prototype draws the *frame* stand-in (a photo-like still, no
  type), never the type-heavy generated art, so the chrome is judged over a realistic picture.
- **Chrome** overlays: top scrim (back, title + channel/time, badge, shortcuts (fine pointer
  only), panel toggle), bottom scrim (readout row, timeline with bands, control row). The scrims are
  fixed-height layers independent of the chrome's own height: bottom `transparent → rgba(0,0,0,.7)
  30% → .88 60% → .92` over 300 px (210 in short landscape), top `rgba(0,0,0,.78) → transparent`
  over 180 px (120). Bright lower thirds and snow must never show through the readout. Idle after
  3 s of no pointer/key input while playing → chrome fades, cursor hides. Not while a menu is open
  or the pointer rests on chrome or panel.
- **Control row** (one height, `md`; play button `lg`): play/pause, −10 s, +10 s, From start
  | mute + volume slider | current time (≥1100) | speed `1×` | audio & subtitles | quality
  | Fill/Fit | Fullscreen. Under 1100 px hide the time and the small labels; under 900 px pills
  become icon + value only. The clock time shows only for live sources; for finished recordings the
  sub line ("15:01 of 1:15:00 · ends 21:10") is the single place for the position.
- **One Go live control:** the red pill at the right of the readout row (and `End`). The control row
  and the phone transport carry no second Go-live button, so screen readers hear it once.
- **Big play button** (centre, while paused) is `visibility: hidden` while playing; the control
  row's play/pause is the keyboard target.
- Tooltips follow state (mute button: "Mute M" / "Unmute M").
- **Volume:** mute button (icon reflects 0 / low / high) + 96 px slider; ↑/↓ ±5 %; `M` mute.
  Remembered per device (`ss-player.vol`, `.muted`). Hidden slider under `pointer: coarse`
  (hardware volume); the phone player has a "Sound" chip for mute. An OSD pill confirms changes.
- **Speed:** menu with 0.75 / 1 / 1.25 / 1.5 / 2; keys `<` `>`; opening it focuses the checked
  item (radio menus focus the checked item); the menu always states "Surround sound plays as stereo
  while the speed isn't 1×". No catch-up mode. When speed > 1
  and behind live, the sub line adds `· 1.25× · live at 19:02` (ETA = now + gap / (speed − 1)),
  only while the ETA falls inside the recording window; otherwise it shows just `· 1.25×`.
  Reaching live at > 1× drops to 1× with a toast "You're live". Surround audio is converted to
  stereo while speed ≠ 1 (stated in the menu and Details).
- **Readout:** `−31:30 behind live` (amber) or `● LIVE · You're watching live` (red; the dot is a
  0.5 em pulsing circle, not a 10 px bullet) or `47:10 left` for finished recordings; sub line `playing 18:11:30 · live 18:42`. A red "Go live" pill sits
  at the right of the readout row (visibility-toggled at live).
- **Pop-in panel** (button or `I`): an overlay card on the right (380 wide, glass), from 72 px
  below the top to 12 px above the readout row (measured, `--chrome-b`), tabs *This
  weekend* (sibling sessions incl. the scheduled ghost) / *Up next*, *Channels* (what's on, with
  progress), *Details* (plain-language stream info, conversion reason, capture health; for running
  recordings: "Recording until 20:30", Extend 30 min, Stop recording). Close button and Esc.
  Keyboard legend at the bottom (fine pointer only, and only when the viewport is taller than
  900 px; `?` always opens all keys). On phone portrait the panel content appears below the
  controls (This weekend, then Channels); Details opens as a bottom sheet (`?sheet=info`).
  In short landscape the panel runs the full height on the right (safe area + 8) and the top and
  bottom chrome fade out while it is open; closing it brings them back.
- **Phone portrait:** picture sticky at top (tap toggles play; big play button while paused),
  below it: badge, title, readout (with the Go live pill), timeline with bands, 5-button transport
  (From start, −10, play, +10, **Mute**; 48 px, play 60 px), chips (speed, audio, quality, details:
  they fit one row at 360 px), then This weekend and the Channels list.
- **Short landscape:** overlay like desktop, compact readout (26 px), no bands and no sub line,
  everything fits in 390 px height (verified: control row bottom at 382 of 390).
- **Errors** cover the picture with a statement title and fixes: row 1 the two real fixes (primary:
  "Stop arte on Kitchen Shield", secondary: Try again), row 2 the quiet ones (Show log, Back to the
  guide), same left edge. Copy follows the stream model (§7.9): "No free stream for watching.
  tvproxy allows 4 streams: 2 are kept for recordings, 2 for watching. Both watching streams are in
  use, by arte on Kitchen Shield and ZDF on Pixel 9."

### 7.2 Keyboard (desktop, fine pointer)

Global: `⌘K`/`Ctrl K` or `/` palette, `?` shortcuts, `G` then `H/G/R/U/S` navigate, Esc closes
the top-most layer. Guide: arrows move (roving tabindex, one tabbable cell; vertical moves keep the
time position, using *now* for the current programme), Enter opens the sheet, `N` now, `P` 20:15.
Player: Space/K play, J/L or ←/→ 10 s, Shift+←/→ 60 s, Home/End, ↑/↓ volume, M, `<`/`>`, A, Q, I,
Z, F. Key hints (`kbd`) render only under `(hover:hover) and (pointer:fine)`. A focused range input
(volume) is not "typing": it consumes arrows, Home/End and PageUp/PageDown, and every other
shortcut (Space, letters) passes through to the player.

**Esc closes the innermost layer**: an inline step, then a menu, then the sheet or dialog, then the
player's panel, then the player. Each layer stops the key (`stopPropagation`) so the one under it
(Base UI Dialog) doesn't close too.

### 7.3 Focus
- Visible ring: 2 px `--focus`, 2 px offset (cards: ring on the artwork, 3 px offset). Menu items
  get an inset 2 px ring on `:focus-visible`, not only the hover fill.
- Sheets and dialogs are modal: Tab and Shift+Tab cycle inside (verified 30/30 and 12/12 tab
  presses stay inside), everything behind is `inert`, the page doesn't scroll (`html` overflow
  hidden; `scrollbar-gutter: stable` keeps the width; verified wheel 600 px → scrollY unchanged at
  1440 and 390). Menus lock scrolling too. e2e: "Tab cycles inside the dialog" and "wheel over the
  dialog doesn't scroll the page".
- Every overlay returns focus to its trigger on close (palette, sheets, dialogs, menus, panel).
- The choice dialog focuses its primary option when opened from the keyboard; Enter picks it;
  ↑/↓ move; Esc cancels.
- **Initial focus follows the input modality** (Base UI's focus-visible heuristic). Opened from the
  keyboard: the first control visible at the current snap (the footer's primary on phones, the
  close button in the side drawer, the checked item in a menu sheet, the first field of a form
  dialog such as Invite's Name, never its Close button). Opened by tap, click or deep link: the
  sheet or dialog container itself (`tabIndex=-1`, no ring), so no button looks selected on a
  phone; the next Tab enters the content.
- When the trigger lived inside an overlay that the new one replaces (a menu sheet item opening a
  dialog), focus returns to that overlay's trigger (the avatar), never to `<body>`.
- **Inline steps keep your place.** Every inline step names its focus targets:

  | Step | Opens with focus on | After the confirm | After Cancel |
  | --- | --- | --- | --- |
  | New collection… (programme sheet) | the name field | the *Goes to* select (now showing the new collection) + polite "Collection created: Der Pate. Goes to Der Pate." | the *Goes to* select (back on Automatic) |
  | New collection… (rule editor) | the name field | the *Collection* select | the *Collection* select |
  | Delete… (recording detail) | the Delete button of the inline confirm | the library (route change) | the ⋯ menu trigger |
  | Revoke (device) | the confirming Revoke | the row's "Signed out" status (+ polite announcement) | the row's Revoke |

  The container that held the step is removed only after focus has moved; focus never falls to
  `<body>`. Announcements go to one polite live region (`#sr`), separate from the toasts; a toast
  that repeats an announcement is `aria-hidden` (one announcement per event).
- **An inline step is its own `<form>`**: Enter in its field submits the confirm, Esc cancels only
  the step (the select goes back to Automatic, focus returns to the select) and never the sheet
  around it. e2e: "Enter creates the collection" and "Esc cancels only the step" in the programme
  sheet and the rule editor.

### 7.4 Artwork hierarchy
1. **Guide image** (XMLTV `<icon>`) when present.
2. **Frame from the recording**, grabbed 10 min in once available (server job; cache per recording).
3. **Generated artwork** from genre, title and channel (A's system): sport = carbon + speed
   stripes (angle ±30–76° and offset 18–70 % from the title hash, mirrored on odd hashes, so a row
   of F1 sessions doesn't repeat) + Anton;
   crime = teal crosshair + DM Serif; film = sepia vignette; news = grid; docs = contour lines;
   kids = shapes in warm, moderately saturated colours (≈ 58 % S, no fluorescent lime) + Fredoka;
   news = grid with a rule **below** the wordmark; show = diagonal light. Channel mark top-right.
4. Later (setting, off): online enrichment from TMDB with the user's API key.

**One resolver for every surface.** `artworkFor(item)` returns the source and URL for a programme
or recording, and every surface uses it: cards, rows, the programme sheet, the choice dialog, the
mini player, the hero background and poster, the recording detail, the player poster frame. A
recording has its frame once 10 minutes are captured (running recordings included: Qualifying shows
its 18:10 frame everywhere); a failed recording has none; a programme with a running recording uses
that recording's picture; otherwise the guide image, else generated. Generated art is therefore what
you see for programmes, rules and collections that have nothing to grab a frame from.

The source is visible in the recording detail (badge on the artwork + "Artwork" fact with the
reason) and in the hero poster ("Frame from the recording · 18:10" = the moment it was grabbed,
10 min in; "Image from the guide"). The hierarchy has to *look* right: a frame and a guide image
are photographs (soft, real light, no type), generated art is the designed fallback. The prototype
draws photo stand-ins per genre (F1 race with varying car and position, football pitch, indoor
scene for crime/show, news studio, bright outdoor scene for kids, landscape for docs, sea still for
films) so "frame" visibly beats "generated" and a children's show never shows a crime still; the
build uses real images. Kids generated art keeps its second accent at ≈ 50 % saturation.
Implementation: `<Artwork src={guideUrl ?? frameUrl}>` renders the generated art as the
background and fades the image in on `load`; same box either way.

### 7.5 Groups and collections (PLAN 6.6, recording-model.md)
- **Automatic groups** are the normal case and need no setup: guide series data → `Show › Season
  › Episode`; sub-title without numbers → `Show › Year › Sub-title`; category film → `Films ›
  Title (Year)`; anything else → `Title › Date`.
- **Collections are optional.** People meet them when Slipstream offers one: right after *Record
  series* / *Record every…* and in the library's suggestion slot, only when a series recording's
  programmes would scatter over several automatic groups ("Group these as “Live F1”?" · *Group
  them* · *No thanks*; TV and phone *Not now*, which never declines for good). A collection made
  from a series recording **follows** it: its conditions are the series recording's channels,
  title and categories (one source of truth; the row keeps a snapshot so nothing ever fails open),
  and it still takes matching recordings made by hand. Only people who may create collections can
  link; a profile without that right that changes a linked series recording's conditions unlinks
  the collection (it keeps today's conditions). Standalone collections (made by hand, by *Make it
  a collection* or a suggestion) keep their own matcher: channels AND (title starts with /
  contains, category, label) + layout parts + retention. Recordings of a series recording never
  feed the generic "make it a collection" suggestion; for them only the series offer exists.
- Precedence: pinned by hand › the series recording's collection › most specific matcher › user
  ranking. A linked collection's specificity comes from the series recording's conditions.
- Library "Collections & shows" view (German "Sammlungen & Sendungen"): *Recording now* →
  *Collections* (with **New collection**) → suggestion card (a scattering series recording first,
  then the generic "make it a collection") → *Shows & films* (each tile labelled "From the guide's
  series data", "Grouped by title and date" or "Guide category: film"). Group pages offer "Edit
  collection" or "Make it a collection".
- Recording detail: "In **Formel 1** · collection · follows the series recording “Live F1” ·
  Move…", "In **Formel 1** · collection · because the title starts with “F1:” · Move…" vs "In
  **Tatort** · from the guide's series data (Folge 1247) · no collection · Add to collection…"
  (menu: collections + "New collection from this…").
- Export template (Settings › Storage): `{group}` = the group path above; `{collection|show}` =
  collection name, else show. Examples shown for a collection, a guide series and a film.

### 7.6 Watch choice ("resume prompt", Plex-like)
Opening anything that **already started** opens a small dialog, not the player:
- a running recording (recording-now cards, On-now cards of recorded channels, guide row play,
  recording pill, palette, "Watch" in the programme sheet footer): artwork + title + "started 42 min
  ago", compact timeline with your position, then **Resume at 18:11** (only with a resume
  position; "Where you stopped · −31:30 behind live"), **Watch from start** ("From 18:00 · −42:00
  behind live"), **Watch live** ("Join now at 18:42");
- a finished recording you started (Continue watching, library cards, detail page Resume):
  **Resume from 46:30** ("46:30 of 1:15:00 · 28 min left") and **Play from the beginning**.
Only items without a position play directly. The first option is primary and focused; ↑/↓ move,
Enter picks, Esc cancels. The compact timeline starts at the **programme start** (18:00), so "From
18:00" and the timeline's first label agree. In short landscape the dialog lays out artwork, title
and timeline on the left and the options on the right, all on one screen. Cards never carry inline From start / Live buttons. The hero keeps
explicit buttons because it is the one place the choice is the content. Under 600 px the dialog is
a bottom sheet (grab handle, drag to dismiss, options in thumb reach). URL: `?choice=<recId>`.

### 7.7 Extra time defaults
Settings › Recording: global default (2 min early / 10 after) and overrides per channel or guide
category (Sport 5/60, Sky Sport F1 5/60, Film 2/15); channel beats category. The programme sheet's
Record once/series and the series editor start from the matching default and say which, with its
values ("From your Sport default (5 min early, 60 after) · Change defaults"; a rule with its own
values: "Overrides your default (2 min early, 10 after) for this series recording"). A series
recording's own extra time always wins in every copy that quotes it (hero "Records 19:25–20:20
with the series recording's extra time").
"Change defaults" is shown to the admin only; other profiles read "Defaults are set by Jonas
(admin)." Changing a default never rewrites existing series recordings.

### 7.8 Users
- **Household profiles** (same device, quick switch from the avatar menu, optional 4-digit PIN,
  own watched state, resume positions, continue watching, mini player, series recordings, "Mine"
  filter).
  A switch re-selects everything: hero (selection order of §8.1 with *this* profile's resume
  positions: Mara lands on Borowski, "You stopped at 18:34"), every Home row, the recording pill,
  the guide, the library, the palette.
- **Access** (Kids, and guests): channels and collections. Kids sees KiKA and Das Erste in live TV
  and the guide, and only the Kids collection in the library; recordings it can't see are never
  in its hero, rows, pill, mini player or search.
- **Access is checked on where an item lands.** A scheduled programme counts as the collection it
  will go to (the series recording's collection, else the automatic group): Kids never sees Mara's *Tatort:
  Unter Wölfen* or Jonas's Tagesschau in Home › Scheduled recordings, the Scheduled tab count, the
  guide's scheduled rings or the programme sheet's "Will be recorded". Series recordings: a restricted
  profile sees only series recordings on channels it can see that record into collections it can see; templates and
  the "make it a collection" suggestion follow the same check; the palette searches only what the
  profile can see. Non-admin profiles without restrictions (Mara) see other people's series
  recordings **read-only**: the switch is disabled and the meta line says so in words ("🔒 Jonas's
  series recording, read-only"; the switch's tooltip "Only Jonas can change it"); they edit and pause only their
  own. Possessives follow English: "Jonas's", "Kids'".
- **Repeats follow access too:** a series recording only leaves an airing out because of a
  recording its owner may see, and the sheet's and guide's "Already recorded Sun 22" only name
  such a recording.
- **Recording as a collection-limited profile** (Kids, guests who may record): *Goes to* lists only
  the profile's own collections and defaults to the first (Kids); "Automatic (…)" and "New
  collection…" are hidden, because the result would vanish from the profile's own library. If the
  programme is already scheduled for someone else into a place the profile can't see, the sheet
  says "Already being recorded for the household" (badge "Household recording", where it goes,
  "Ask Jonas (admin) to share it") and offers no second capture (no Record button; Watch live when
  it is on now). The server
  storage meter (Recordings header) is admin only, like the Server strip.
- e2e: "Kids sees no Tatort, Tagesschau, F1, Formel 1 or Terra X" on Home, Recordings, Scheduled,
  Series and in the palette's Recordings / Collections / Series recordings groups (the guide still lists what Das
  Erste airs). Same test: Kids' sheet for *Tatort: Unter Wölfen* says "Already being recorded for
  the household" and has no Record button; Kids' sheet for an unscheduled Das Erste programme
  offers *Goes to: Kids* only.
- **Admin only:** Needs attention items about sources and conflicts, the Server strip, Settings ›
  Sources, Recording, Users & devices, Playback, Storage. Other profiles see the problems of their
  own recordings (Mara sees "Tatort: Schweigen ist Gold failed") and a "Your profile" settings page
  (name, picture, PIN, theme; "managed by Jonas (admin)").
- **Guests** (own account, invited by link with expiry, sign in from anywhere): what they see
  (channels and collections), may record, stream limit; never admin. Pending invites listed with
  Copy link / Revoke.
- Devices: per-device tokens, revoke with inline confirm, TV approval flow names the device,
  model, network and asks which profile it signs in as.

### 7.9 One notation per kind of time, one stream model
- **Running** things (live, recording now) use the wall clock: "You stopped at 18:11", "Resume at
  18:11", "playing 18:11:30 · live 18:42". **Finished** recordings use the position in the
  recording, always with its length: "Stopped at 46:30 of 1:15:00", "Resume from 46:30". Hero
  button, read line, knob label, choice dialog, mini player and palette follow the same rule.
- **Streams:** "tvproxy allows 4 streams: 2 are kept for recordings, 2 for watching." Scheduled,
  conflicts ("only 2 can record at once"), the Server strip ("4 of 4 streams · 2 recording, 2
  watching"), Settings › Sources and the player error are all written from this sentence.
- **Counts** come from one source: the Recordings badge, the Problems tab and Needs attention use
  the same issue list (4); Scheduled's tab count is the list's length; a collection tile and its
  page both count running recordings; "new" (never "unwatched") counts new recordings. The
  "Unwatched" filter chip is a different thing: not finished by you.

---

## 8. Screens

### 8.1 Home
1. **Hero** (`.cine`, fixed height). Selection, first match wins:
   1. *Onboarding*: no source, or no enabled series recording and no recordings → "Almost
      ready", checklist (Add a source ✓ / Create your first series recording), CTA Record a
      series (opens the guide), Templates.
   2. *Recording now*: ≥ 1 running recording visible to this profile. One → that one. Several →
      the same layout plus the **switcher**: equal tabs (channel logo, title, live progress,
      since, owner), `role=tablist`, ←/→, no auto-rotation. Initial selection: the one this
      profile has a resume position in, then the one it owns/its series recording recorded, then the earliest
      start. Shows a quiet eyebrow (15 px / 500: group · event · "started 42 min ago", a `<p>`
      right above the `<h1>`, never inside it), title,
      description that never repeats the title ("Recording 17:55–20:30: 5 min early and 60 min
      after the scheduled end at 19:30, in case it overruns."), read line "You stopped at 18:11 ·
      −31:30 behind live" (or "you haven't watched any of it yet"), timeline, actions Resume at
      18:11 (primary, when resumable) / From start / Live, or Watch from start / Watch live. On
      phones the primary keeps the time ("Resume 18:11", "Resume 46:30"), so hero and choice
      dialog name the same moment. **The action row never makes the page wider** (hero column
      `minmax(0, 1fr)`, buttons `flex: 1 1 0; min-width: 0`): under 600 px the three-way choice
      folds Live into a 48 px round glass icon button (red live glyph, `aria-label="Watch live"`),
      the primary keeps its natural width, From start takes the rest, and under 390 px From start
      drops its icon. e2e (isMobile, 360/375/390): all five hero states, both switcher tabs, Jonas
      and Mara: `scrollWidth === clientWidth` and `innerWidth === clientWidth`.
      *Why tabs:* all parallel recordings get equal standing in the place you look first, the
      hero keeps one size, nothing rotates, and "Also recording" can no longer hide anything.
      A separate "Recording now" row would repeat the hero item and push everything else down.
   3. *Starts soon*: a recording starts within 60 min → "Starts in 43 min", what it is, the
      recording window with defaults and where it goes, timeline anchored to round half hours
      (18:30–20:30) with the current programme and the scheduled one as bands and a red `Now
      18:42` marker as the anchor for "in 43 min", Recording options
      (programme sheet; no icon) / Watch the channel now.
   4. *Idle*: continue watching (most recent, < 7 days, an item this profile has a resume
      position in) → else newest unwatched recording → else what's on a favourite channel. Read line "Stopped at 46:30 of 1:15:00 · 28 min left",
      Resume from 46:30 / From start. Badges: Continue watching + channel (the day is in the eyebrow
      only).
   5. *Onboarding* poster: a tilted wall of generated artwork behind the mark; the done step is a
      green check with muted text (never strikethrough).
   The poster on the right (≥1100) shows the best artwork and its source label. All five states
   share one height; a state this profile can't see falls back to Idle.
2. **Needs attention** (if any, filtered per profile §7.8): issue cards with the fix; dismiss →
   toast with Undo. Titles never run under the dismiss button.
3. **Continue watching** (per profile), **On now**, **Scheduled recordings** (cards with a
   "Tomorrow 17:00" pill and a Conflict badge on *every* item of an overlap; tap opens the
   programme sheet), **New in your library**: all rows are the same MediaRow with the same section
   head (title + "more" link); a row with nothing in it is left out. **Continue watching** holds
   only items this profile has a resume position in (started, not finished), so nothing in it is
   ever new; "New" means not started by this profile, so an item in Continue watching never also
   carries the new dot or appears in New in your library. The item the hero shows is not repeated
   in the row right under it. Row arrows (≥1100, hover) only exist when the row can scroll.
4. **Server** (admin): "4 of 4 streams · 2 recording, 2 watching · 2 kept for recordings" (orange
   at the limit), storage, guide updated, conversions.

### 8.2 Guide
- Header: title; toolbar (desktop timeline: **Now** `N`, **20:15** `P`; view segmented control
  **Timeline | Channels**: one name and one order at every width);
  day pills (8 days, one line "Sat 21", `md` height like the chips beside them); category chips
  (dim non-matching cells). Under 768 the categories fold into a **Filter** chip in the toolbar
  (a menu, a bottom sheet on touch), so the phone header is title + toolbar + days + time slots.
- **Short landscape** (`max-height: 520px`): one header row (title 24 px, Now, 20:15, a day menu
  "Today 21 ▾", Filter, view toggle); no day pills, no category chips, no key legend; the grid takes
  `100dvh − nav − 76` so the page itself doesn't scroll (no nested scroll); the mini player is not
  rendered on the guide there. The channel column is 96 px and shows number and logo only (the
  name stays in the link's label). Day notation is the pills' everywhere ("Today 21", "Sun 22").
- **One scroller from 768 px:** the timeline is sized to exactly what is left of the viewport
  (viewport − its top − legend − `main`'s bottom padding, which includes `--mini-h`), so the page
  itself never scrolls (the first trackpad gesture moves the grid) and the mini player sits below
  the legend, never over a row. Verified: document height = viewport at 1440×900, 1024×768,
  768×1024 and 844×390.
- The global skip link reads **"Skip to the guide"** on the timeline (it is the first Tab stop)
  and focuses the grid's roving cell, so keyboard users don't tab through the nav, 8 day pills and
  7 chips.
- Contrast: ruler half-hour labels `--fg-3` (never `--fg-4`); cell meta `--fg-2`. Past cells are
  transparent with a hairline; the current programme's elapsed part is a faint red tint (`--live`
  7 %), so what is on now reads stronger than what ended, in both themes.
- **Timeline** (default ≥768): sticky channel column (208 / 168 px) and time ruler (40 px), 5 / 4
  px per minute, rows 78 px; cells opaque with a progress tint for the current programme; red now
  line **behind** the cells (cells z 2, line z 1) with a now chip in the ruler that hides the ruler
  labels it would cover; titles stay visible while scrolling horizontally; cells < 26 px become
  hatched micro cells (no text, label in aria and title); markers: red dot recording, amber ring
  scheduled, orange conflict, neutral `--fg-3` check for an episode you already have or have
  scheduled, whether one of your series recordings left the airing out or not (same marker slot,
  label "already recorded" / "already scheduled"; from `GET /guide/repeats`). Scroll position persists across sheet open/close and re-renders.
  The current programme's elapsed tint ends exactly at now, so the line appears to continue
  through the cell; the line itself stays behind the opaque cells. Cell labels carry day and
  state, and start with the channel so a row change is heard: "Das Erste, Sportschau, today, 17:15
  to 19:57, live now", "ZDF, Terra X…, scheduled, conflict". The scroller is a labelled `region`,
  not a `grid` (§10).
- **Channels** (default on phones): what's on at a chosen time, per channel: logo, title,
  "until 19:57 · 75 min left" in the *Now* slot (the slot already says live, so no "Live" on every
  row; the end time first, so nothing useful truncates), "20:15–21:45" in a later slot, progress, next programme, actions: an outlined Record button
  (red dot) for anything not yet recorded, plus Play when it is on now; time chips
  *Now 18:42 · 19:00 Early evening · 20:15 Prime time · 22:00 Late*. Channels without guide data
  say so and offer Watch live. *Why keep it:* the old "Now & next" repeated the grid as cards and
  confused; this list answers "what's on now / at 20:15?" in one glance on a phone where a grid
  can't, and it is the single most common living-room question.
- **Timeline on phones**: per-channel swipeable strips with time-slot jumps.
- Programme sheet from any cell (§8.3).

### 8.3 Programme sheet
Layout: **phone** — the artwork starts flush at the sheet's top edge with the grab handle drawn
over it on a soft scrim; no close button (drag down or tap the backdrop; Esc and back work too).
**Half snap is sized to content:** it shows the artwork, badges, title and the facts line fully,
and the pinned footer starts exactly where the next element begins, so the footer never cuts a
text line (measured from the `facts` row + 16 + footer height; when a live timeline follows the
facts, from the timeline block instead, so its live-edge halo never peeks above the footer). No half snap when that would save < 96 px or when the viewport is under 520 px
tall. **Phone landscape** — a centred column of max 560 px, opens at full, art capped at 40dvh.
**≥768** — side drawer with a 60 px header row (channel · day time, close button), the artwork
inset below it with 12 px radius; the close button is never on the artwork. In short landscape
the header row is 48 px and the art an 88 px band (12 px inset above it), so the title, badges
and the whole facts line sit above the footer when the drawer opens. Artwork
inside sheets has no title text (the title follows right below).

**Sticky footer: one primary per sheet, always the thing you most likely want next.** Every footer
control is `lg` (48), so the footer is 73 px on every sheet:

| Programme | Footer |
| --- | --- |
| live, recording now | **Watch** (primary, opens the choice dialog) · Series options (ghost) |
| live, not recorded | **Watch live** (primary) · Record (secondary, red record glyph) |
| future, not scheduled (also `Owned`: you have the episode, no series of yours decided) | **Record** (primary) |
| scheduled / in conflict | Skip this one (secondary) · Series options (ghost) |
| `Repeat`: one of your series recordings left this airing out (future) | Record anyway (secondary) · Series options (ghost) |
| `Repeat`, live now | **Watch live** (primary) · Record anyway (secondary) |
| ended, not recorded | no footer |

The body never carries a second primary. *Stop recording* is a destructive, rare action: it lives
in the record section of a running recording (danger `sm`), not in the footer. *Series options*
(German *Serienaufnahme ändern*, which must fit beside *Trotzdem aufnehmen* at 390 px; it wraps,
never truncates) appears only to people who may edit that series recording. A left-out airing has
no primary: nothing is the obvious next step, and *Play it* sits in its status box.

Content: badges (Live now, Recording, Scheduled, Conflict, Household recording, Already recorded,
Already scheduled; the badge row is
left out when there is none, instead of an empty band), title, **facts as one sentence**
("Sky Sport F1 HD · Today · 18:00–19:30 · 1 h 30 min · Sport", logo beside it, durations with
non-breaking spaces), compact timeline when live (red live edge; flat for what aired, dashed for
what hasn't; your knob only if you have a position) with the caption on its own row, for a live
programme you don't record the hint that starting from the beginning needs a recording, description,
then record section: Record once / **Record series** (identity class Episode: episode data or an
identifying sub-title, also for a Fernsehfilm series like Tatort: "Every episode of “Tatort” on
Das Erste") or **Record every “Live F1”** (Event or Broadcast: live, sport, news: "Every broadcast
on Sky Sport F1 whose title starts with “Live F1:”", prefix marked); no second row for a film. The
kind comes from `recordEveryKind`, derived from `episodeIdentity`. Hint: "Records new episodes
from now on, only ones you don't have yet. Change it any time under Series recordings." *Record*
stays busy until the series recording is saved and planned, at most 1.5 s, so the sheet swaps
once; the scheduled state's status box then has two fixed lines, "Scheduled · by your series
recording Tatort" and "4 upcoming". When its programmes would scatter (recording-model.md §3.3),
the second line becomes "Shows up in 3 places in Recordings · Group them…" in the same line box;
*Group them…* opens the offer step (name, layout preview, *Group them* · *No thanks*). Toast
"Series recording added: Tatort · 4 upcoming" (broadcasts: "…: every “Live F1”") with Undo, which
also removes owners it added and a collection created from it.

An episode you already have, by the one table of recording-model.md §3.1:

| Status | Badge | Body |
| --- | --- | --- |
| `Owned` (you can see a recording of this episode; none of your series recordings decided about this airing) | Already recorded / Already scheduled | status line "Already recorded Sun 22, 15:00 on ONE · Play it" above **both** record rows; Record series stays offered |
| `Repeat` (one of your series recordings left it out) | Already recorded / Already scheduled | the status box "Already recorded Sun 22, 15:00 on ONE · Play it" / "Already scheduled Tue 24, 20:15 · Show it" / "You had this episode (recorded Sun 22). It was deleted." **instead of** the record rows |

Start early / Keep after steppers from defaults. **Goes to: Automatic (Formel 1)** select only
when the profile can see at least one collection, otherwise behind *More options* (collections the
profile can see; picking one pins it, hint says so; what you pick is stored on the scheduled item
and decides where it lands). The sheet has **no New collection…**: the collection offer after
*Record series* is the one way a collection starts here; the editor (§8.6) keeps New collection….
A collection-limited profile gets its own collection instead (§7.8). Relative days inside
sentences are lower case ("Just this programme, tomorrow at 20:15"). For recording /
scheduled: who/which series recording, extra time for this one. In a conflict, every item of the overlap shows
the conflict box with **every** way out: Skip Tagesschau / Skip Terra X / End Rennen at 20:00 /
Record the repeat instead (Wed 25, 22:00) when a later airing of the same episode exists and no
served one was planned automatically / All scheduled.

### 8.4 Recordings
Tabs Library / **Scheduled** / Problems (counts from §7.9; all filtered by the profile's access).
The storage meter in the header is admin only. Library toolbar (search, group-by
segmented, All/Unwatched/Mine chips in their own group that stays together and scrolls as one row on
phones; one height). Views per §7.5; By channel / By date group tiles under
sticky headers. Scheduled: by day, every overlapping item flagged (day label in `--fg-2` on the
tinted row, Conflict badge in `--warn-ink`), the resolution under the last item of the overlap with
one option per item that can give way (Skip Tagesschau · Skip Terra X · Shorten Rennen); options
wrap under 700 px instead of widening the page. Problems: issue cards. Collection
page: header art, why, layout, retention, Edit; Formel 1 by season and event with the scheduled
ghost card. Recording detail: artwork with source badge, gap timeline when incomplete, the description under
the artwork (left column), problem box with fix, Play / Resume from 46:30 (choice dialog), a
labelled Protect button, more menu (Add to collection, label, watched, Delete with
inline confirm), "In …" box, facts incl. artwork source and export path (absolute, the same form as
the Settings › Storage examples: `/media/tv/Tatort/Die Nacht der Kommissare/…mkv`). The side column is not
sticky (nothing hides under the mini player, which is not shown on the detail of the item it plays).
A **failed** recording offers *Record the repeat* (when the guide lists one; found by episode
identity, `findRepeatAiring`) and *Delete* as visible buttons, and no Protect; its facts say "Not
exported, nothing was captured" instead of an export path. A failed or gappy recording of a series
recording says instead what happens on its own ("Recording had gaps. Recording the repeat on Wed
25, 22:00 instead." / "No repeat in the guide yet. Slipstream keeps looking until Sun 6." / "No
repeat found."); deleting it offers *Delete* (Slipstream still records the repeat) and *Delete and
stop looking for a repeat*, and never adds it to the episode history. The repeat's facts say
"Replaces the recording from Sun 22, which had gaps" with *Keep the original* for 7 days (the
replaced recording is hidden, not deleted, until then); a repeat that is shorter than 90 % of the
original is kept next to it ("Repeat recorded too"); see recording-model.md §3.7. Deleting a good
finished episode of a series recording set to *Only episodes you don't have yet* offers *Delete*
and *Delete, record it again when repeated*. The channel mark on artwork is capped (≤ 30 px tall, 14 px type) so it never
dominates a large frame.
The artwork's play overlay and the primary Play button are one decision: both exist only when
there is something to play (never for a scheduled or failed recording). A **scheduled** recording
speaks of what will happen, like the programme sheet (§8.3, the same sheet states): a Scheduled
(or Conflict) badge in the reserved badge row, a primary line "Starts Tue 24 · 16:40" (the padded
start, in the household's days) where Play would sit, *Skip this one* (deletes the scheduled
item) and *Series options* when the profile may edit the series recording; no Protect or more menu. Its facts
use future wording (Airs, Planned length 2 h 20 min, Will record by) and leave out Size.
An **incomplete** recording's problem box lists each missing stretch on its own line (merged,
in time order, with its cause) and then the missing total ("2 gaps, 6 min missing in total");
gaps that cover the whole window read as a failed recording.
Days everywhere in Recordings (day pills, By date, Scheduled) are the household's
(`system.timeZone`), the same days the Guide shows; until the zone is known the screens are a
skeleton. Under 768 px the breadcrumb trail collapses to one back link to the parent
("‹ GP Katar", ≥ 44 px). Both storage meters (here and Settings › Storage) split the used space
into recordings, pause and rewind and *Other files* (used − recordings − pause and rewind, a
neutral colour with its own legend entry), so bar, legend and "used of total" add up.
**Short landscape:** no storage meter; the Mine/Unwatched chips, search and group-by share one
scrolling row, so the first item starts in the first screen.

### 8.5 Collection editor (`/recordings/collections/new|:id`, `?from=<group>`, `?advanced=1`)
Name; *Layout*
(an example title from the library with marked parts, group path parts shown as words: Formel 1 ›
Year › Event › Programme, with remove and "+ Part" menu showing example values, a sentence of what
the example becomes; before anything belongs in it, a one-line hint instead of filler); *Keep*;
and an **Advanced** disclosure ("Advanced: what belongs here", closed unless the conditions are
empty or invalid, or `?advanced=1`) holding *What belongs in it* (channels, title starts with,
category, labels: token inputs) and the overlap check in ok-green ("No overlap with your other
collections."). A collection that **follows** a series recording shows one line instead of the
conditions, "Follows the series recording “Live F1”: Sky Sport F1, titles starting with “Live
F1:”" with *Series options*; inside Advanced, *Use its own conditions instead* copies them and
stops following (its conditions cannot be edited while it follows). Template braces appear only
in the export template field. Both editors use one form layout: labels on top of their fields. Sticky preview: the library as it would be placed (tree),
count (neutral badge at 0), items that can't be split go to **Other**. Save bar: Create/Save, Cancel,
"12 recordings · not saved yet". Token fields share the input inset (14 px to the text) and the
15 px input size; tapping anywhere in a token field focuses its input.

### 8.6 Series recordings (`/series`)
Page title *Series recordings* (navigation: *Series*), intro "Shows and events Slipstream
records for you. Start one from any programme in the guide." List of series cards (art, name, owner,
summary, next airing, count, switch), templates row; both filtered by the profile's access (§7.8);
other people's series recordings are read-only for non-admins. Empty state: "No series recordings
yet" with the primary fix *Open the guide*; *New series recording* stays as a secondary button.
Most series recordings are made from a programme (§8.3); the editor is for refining. Editor
weekday pills: pressed = `--brand-soft` fill + amber hairline + `--fg` label (never solid white).
Editor ("New series recording" / "Edit series recording"): plain-language summary at top,
sections Name & channels, Title (conditions with tokens; note on exact, case-sensitive matching;
regex behind More options), When (weekdays), Extra time (from defaults), **Episodes** (radio
*Only episodes you don't have yet* (default) / *Every airing*, with the help line; for
date-identified programmes the note "For live events and programmes without episode data, “don't
have yet” goes by date…"; when the history has rows, "12 deleted episodes won't be recorded again
· Forget them"), **Goes to** ("Automatic (Formel 1)" names today's result; "Automatic (by title
and date, 4 separate places)" with *Group them in a collection* when they scatter; a linked
collection reads "Formel 1 (follows this series recording)", and choosing another place says
"Formel 1 will keep today's conditions and stop following this series recording"; collections,
New collection… as an inline step) and Keep. A linked series recording edited by a profile that
may not edit collections shows the notice that saving changed conditions unlinks the collection.
Sticky preview with "will record", "similar, won't record" plus the reason ("Excluded: title
contains “Pressekonferenz”") and left-out airings ("Already recorded · Sun 22, 15:00"),
changed rows flash. Save bar: Create/Save, Cancel, "6 will record · not saved yet", Delete (the
confirm asks whether to keep a linked collection, keep is the default).
**Short landscape** (`max-height: 520px` and landscape): the editor drops its crumbs (Cancel in
the save bar is the way back) and the summary is one truncated line that opens on tap, so the
first field is on the first screen at 667 × 375.

### 8.7 Settings
Sections: Sources & channels, **Recording** (defaults, overrides, artwork order, TMDB later),
**Users & devices** (profiles, guests, devices, sign-in methods), Playback & conversion, Storage
(meter, floor, location, export template, import). ≥1100: side nav; below: horizontal pill nav.
- Recording defaults under 600 px: each row is name + hint with the delete button in the row
  header, then "Early [stepper]" and "After [stepper]" on their own labelled lines (column headers
  only from 600 px).
- Users: "Add profile" is the last card of the profile row (dashed outline, plus, "Name, picture,
  optional PIN"); from 1100 px the row is a 4-column grid; profile cards stretch to the row and pin Edit to
  the bottom, so names and Edit line up whatever the description length; pending rows (invite, TV request) get a 3 px amber edge and a faint
  tint instead of an amber-soft fill.
- Storage: *Recordings location* (captures and timeshift, `/mnt/user/slipstream`) and *Library
  folder* `{library}` (where finished recordings are exported, `/media/tv`) are two fields;
  `{library}` is listed first among the variables. Examples: Collection · No collection · guide
  series (Show/Season/Episode) · series without seasons (Show/Episode) · no series data
  (Title/Date) · film, all under `/media/tv`.
- Non-admin profiles: one section, *Your profile*.
- Headings in list rows wrap (never "Look up missing artwork a…").
- Invite / edit guest is an `sm` Dialog (a bottom sheet under 600 px) with a sticky action footer;
  under 600 px row labels such as "Streams at the same time" sit above their stepper. The token
  field's placeholder is "Add…" (the full "Add a channel or collection" is its label).

### 8.8 Auth
Setup (4 steps, test source before continue), sign-in (password + SSO, inline errors), TV
approval (device, code, warning, profile choice: "Household · Jonas, Mara, Kids · pick on the TV"
with their avatars, or a named profile; "This isn't my TV"). Desktop shows the drifting
artwork wall (static under reduced motion).

### 8.9 Global
⌘K palette, toasts with Undo, inline confirms (delete, revoke), offline banner + per-screen error
states, empty states with the primary fix, 404. Menu params (`?dlg=account|filter|day`) only
exist where the menu is a sheet (coarse pointer under 768 px); elsewhere a deep link drops the
param and the anchored Menu opens on click. The installed app's `theme-color` follows a manual
Light/Dark choice (the per-scheme metas apply only for System).

---

## 9. Responsive rules
- No horizontal page scroll at any width 360–1600. Measured with `isMobile` contexts too, comparing
  `scrollWidth` with `documentElement.clientWidth` (not `innerWidth`, which grows with the content
  on mobile and hid the round-3 hero overflow): 15 routes and every hero state at 360/375/390, 0
  overflow. Horizontal
  scrolling exists only inside rows, chip scrollers, the guide grid and strips, each with
  `overscroll-behavior-x: contain`.
- Touch targets ≥ 44 px under `pointer: coarse`: `md` becomes 44, `sm` becomes 40 with an
  invisible `::before` hit area (inset −4 px) on sm buttons, icon buttons, stepper buttons, token
  removers and switches; avatar, logo, section links, breadcrumbs, menu items, setting pills and
  the Channels list's "Next" rows get 44 px min-height; segmented controls drop their 3 px padding
  and draw the pressed pill inside a transparent border so the whole 44 px is the button. Timeline
  hit area ≥ 44. Also: token-field inputs and "+ Add channel" selects are 44 tall and the whole
  field focuses the input; inline text links (`ilink`: "Defaults", "Change defaults", rule names in
  facts) get a ±14 px invisible vertical hit area; the "Not matched · Fix" badge, weekday pills,
  channel-list logo links and play buttons, Scheduled thumbnails and rule-card art reach 44; the
  top-bar search button is `--ctl-md` wide; *Goes to* is `md`; chips are at least 44 wide (the
  player's "1×"). Verified with a coarse-pointer audit at 390 on 11 routes: no target under 44
  without a hit area.
- The phone player's four option chips (speed, audio, quality, Details) fit the row at every
  phone width without scrolling or fading (gap 6 and padding 10 under 390 px): 328/328 at 360,
  343/343 at 375.
- Keyboard hints, shortcut tables and tooltips only under `(hover:hover) and (pointer:fine)`.
- Safe areas: `viewport-fit=cover`; every edge: top bar, tab bar, sheets (bottom), `.wrap` gutter
  `max(gutter, inset-left/right)`, rail width `84 + inset-left`, player chrome (left, right,
  bottom), panel, the hero content's bottom padding and the mini player's bottom offset (≥ 768 and
  short landscape), dialogs' max-height and sticky footers.
- **Every overlay fits.** Dialogs: `max-height: 100dvh − top − safe-bottom − 16`, scrolling body,
  sticky action footer; top 8 px in short landscape; `sm` dialogs are bottom sheets under 600 px.
  e2e at 844×390, 667×375 and 375×667: every open overlay's bottom ≤ `innerHeight` and its last
  action is reachable (on screen or by scrolling the overlay). Manifest + `theme-color` per scheme + apple-mobile-web-app tags (PWA).
- **Short landscape** (`max-height: 520px` and landscape): hero `max(360px, 100dvh)` with the
  description and eyebrow dropped and the CTAs on screen; menus capped at `100dvh − 16` and
  scrollable; compact guide (§8.2: one header row, grid `100dvh − nav − 76`, no mini player);
  compact rail items; mini player 300 × 48 without its Live button and without the event
  suffix (also dropped on phones: "Qualifying", not "Qualifying · GP Katar"); side drawer with an
  88 px art band; Recordings without the storage meter and with one tools row; the compact guide
  header at any width (667×375 included); phone bottom sheets centred (max 560) without half snap; choice dialog two columns; one
  toast at a time; player panel full height with the chrome hidden while it is open.
- Labels never disappear from navigation (tablet rail has labels).
- Long titles: single line + ellipsis in cards; hero steps the size down first (§6.1); 2 lines in
  sheets and detail.

## 10. Accessibility rules
- Landmarks: skip link → `main#main` ("Skip to the guide" → the grid on the timeline); nav landmarks labelled "Main"; hero `section` labelled by
  state; player panel `aside`.
- Guide: the scroller is a labelled `region` (not `role=grid`: the rows aren't a real grid), cells
  are buttons whose label starts with the channel: `aria-label="arte, Der Pate, today, 20:15 to
  23:05, scheduled"`, so moving ↑/↓ to another row is heard; roving tabindex. Channels list rows
  carry the channel in the label the same way.
- Timeline: slider semantics with `aria-valuetext` in words ("18:11, −31:30 behind live"; at the
  live edge "Live, 18:42", matching the read-out and the hover tooltip); the readout is not `aria-live` (it
  ticks); state changes ("Live", "1.25×", "Volume 60 %") go to a polite live region (OSD).
- Dialogs/sheets: `aria-modal`, labelled, focus trap, focus return. Menus: Base UI semantics,
  radio/checkbox items.
- Contrast: body and meta ≥ 4.5:1 in both themes and on `.cine`; `--fg-4` decoration only (ruler
  half-hour labels moved to `--fg-3`, guide meta to `--fg-2`). Live red text uses `--live-fg`,
  white on red uses `--live-solid`; green text uses `--ok-fg`; amber text in light uses `--brand-fg
  #8A5E00`. Counts on `--warn` fills use `--on-warn` (dark text in dark mode).
- Channel logo chips are decorative images of the brand (`aria-hidden`); their white-on-brand text
  (ZDF, KiKA, arte) is exempt as logotype, and the channel name is always present as text or in
  the label. Real logos replace them in the build; no luminance-picked text colour is needed.
- Colour is never the only signal: recording = red dot + "Rec" badge; scheduled = ring + label;
  conflict = orange + "Conflict".
- Reduced motion honoured; no auto-rotating content anywhere.
- One polite live region (`#sr`) for in-place results (inline steps, revokes), separate from toasts.

---

## 11. Keep vs. throw away (current `apps/web`)

**Keep (logic, tests, plumbing):**
- `api/*` (client, queries, mutations, SSE `events.ts`, hooks, mock server/fixtures): the
  contract stays; add queries for profiles, guests/invites, defaults, collections editor preview,
  artwork source.
- `modules/timeline/geometry.ts` (+ tests): extend with `bands`; rewrite `timeline.tsx` to §5.
- `modules/player/live-position.ts`, `capabilities.ts`, `use-hls-playback.ts`,
  `use-playback-session.ts`: keep; replace catch-up with a plain `playbackRate` + ETA helper
  (keep `catchUp` from `@slipstream/domain` only as the ETA maths).
- `modules/guide/grid.ts` (window, ticks, layoutRow, markers) + tests.
- `modules/rules/draft.ts`, `describe.ts` (→ the summary sentence), `rule-preview` matching logic.
- `modules/recordings/library.ts`, `conflicts.ts`, `retention.ts`, `problem-text.ts`,
  `move-collection.tsx` logic, `collection-suggestions.tsx` logic.
- `modules/auth/device-code.ts`, `modules/sources/source-patch.ts`, `source-text.ts`.
- i18n wiring (`i18n/messages.ts`), Base UI primitives folder, `ui/theme.ts` (theme persistence),
  `use-now.ts`, `loadable.tsx` (re-purpose as the skeleton contract), React Compiler setup.

**Throw away / replace:**
- `ui/app-shell.tsx` sidebar shell → TopBar + Rail + TabBar + MiniPlayer (§2).
- Separate *Live TV* and *Sources* routes (`routes/_app/live.tsx`, `sources.tsx`): live TV lives in
  Home "On now", the guide and the player; sources move to Settings › Sources & channels.
- Big Shoulders Display, Geist, Geist Mono (`type-display`, mono `type-meta`) → Inter Tight +
  Inter with tabular figures.
- Current token values (blue-grey neutrals) → §3 (warm neutrals, cine scope, control scale,
  motion). Keep the token package's three-layer structure and generators.
- `now-card.tsx`, `recording-list.tsx`, `upcoming-list.tsx`, `thumb.tsx` visuals → MediaCard,
  MediaRow, Artwork, ProgrammeSheet, WatchChoice.
- Spinners and "Loading…" placeholders, any `transition-all`, any layout that inserts content
  above existing content after load.
- The catch-up button and catch-up mode in the player.

**Routes (TanStack Router, file-based):**
`/` · `/guide` (search: `view`, `day`, `cat`, `at`) · `/watch/rec/$id` (search `at=resume|start|live|pos`, `t`) ·
`/watch/live/$channel` · `/recordings` (search `group`, `filter`, `q`) · `/recordings/scheduled` ·
`/recordings/problems` · `/recordings/c/$group/$season?` · `/recordings/r/$id` ·
`/recordings/collections/new` (search `from`, `advanced`) · `/recordings/collections/$id` · `/series` ·
`/series/new` · `/series/$id` (`/rules*` redirect) · `/settings/$section` (`sources|recording|users|playback|storage`) ·
`/setup` · `/login` · `/link`. **Every overlay is in the URL** so the back button and the back
gesture close it before leaving the page: `?sheet=prog:<id>` (programme), `?sheet=log`,
`?sheet=info` (player details on phones), `?choice=<recId>`, `?dlg=cmdk|keys|proto|invite[:id]|
pin:<profile>|account|filter|day` (the last three are menus rendered as sheets on phones). Opening an overlay pushes one entry; opening another from it *replaces* that entry;
closing it (button, backdrop, Esc, drag) goes back; a link inside an overlay replaces the overlay's
entry, so back never reopens it. Deep links open the overlay over the page. Verified: back with a
sheet open on /guide → /guide (sheet closed), not Home; the same for the Filter and avatar sheets.

## 12. Build order
1. Tokens (§3) + fonts + shell (§2) + skeleton contract (§6) + Artwork + MediaCard/Row.
2. Timeline (§5) + player (§7.1) + watch choice + mini player.
3. Home with hero states, Guide (grid, channels, strips) + programme sheet.
4. Recordings, collections editor, recording detail; series recording editor.
5. Settings (recording defaults, users/guests), auth, palette, e2e layout-shift and overflow
   tests in CI (port `/tmp`-style Playwright checks into `apps/web/e2e`).

---

## Decisions (round 1 review)

Where reviewers disagreed or the brief left room, decided for the owner's taste: familiar patterns,
zero layout shift, consistency, native mobile feel.

1. **Switcher position.** The parallel-recordings switcher moved to its own slot at the top of the
   hero instead of reserving an empty row under the actions in every state. Same geometry in all
   five states, the CTAs never jump when a second recording starts, and nothing is empty.
2. **Phone sheets have no close button.** Drag, backdrop tap, Esc and back close them; the handle
   sits on the artwork on a scrim. A header row with a close button exists only in the side drawer
   (≥ 768) and on sheets without artwork (the header row then carries the title).
3. **Half snap opens first** for long sheets on phones; the footer actions stay pinned to the
   screen so Record is always one tap away.
4. **Watch choice on phones is a bottom sheet** (same pattern as the programme sheet), a centred
   dialog from 600 px.
5. **Time notation:** wall clock for anything running, position-of-length for finished recordings.
   Never mixed on one surface.
6. **"New" vs "Unwatched":** counts of fresh recordings say "new" everywhere; the filter chip
   "Unwatched" keeps its own, different meaning (not finished by you).
7. **Stream model:** 4 source streams, 2 kept for recordings, 2 for watching. Conflicts are about
   the recording half, the player error about the watching half.
8. **Non-admin profiles** see their own problems only; Server and admin settings are hidden. Kids is
   limited by channel *and* collection.
9. **Categories on phones** live behind a Filter chip rather than a third chip scroller.
10. **Tab bar label** is "Recordings" (one word for one place on every breakpoint).
11. **Short landscape player:** the panel takes the full height and the chrome fades while it is
    open, instead of squeezing the timeline (which would be a layout change).
12. **One form layout:** labels above fields in both editors (works at every width).
13. **Speed menu over the timeline:** kept anchored above its button. A menu opening over the
    timeline it doesn't change is the familiar pattern (YouTube, Plex); moving it away from its
    trigger would be less clear. Not changed.
14. **Volume on touch** stays mute-only (hardware buttons do the rest), as before.
15. **Delete on failed recordings** is a visible button; on healthy recordings it stays in the ⋯
    menu with an inline confirm.

## Decisions (round 2 review)

1. **Menus on phones are sheets, not a second bottom-sheet style.** Avatar, Filter and the day
   picker use the programme sheet's primitive (drag, back, inert, focus trap, URL). Desktop keeps
   Base UI Menu (closes on Tab).
2. **One primary per programme sheet, in the footer.** Watch for a running recording, Watch live
   (with Record as secondary) for a live programme, Record for the future. Stop recording moved
   into the record section: destructive and rare, it shouldn't be the sheet's most prominent
   element. All footer controls are `lg`, one footer height.
3. **"Skip this one"** replaces "Don't record this one": it fits a 375 px footer beside Edit rule
   without wrapping and matches the conflict wording ("Skip Tagesschau").
4. **Half snap sized to content** (art, badges, title, facts) instead of a fixed 52 %. Shrinking
   the art at half and growing it at full was rejected: it would change layout during a drag. The
   art keeps one size; the snap point moves.
5. **Frames are the default for recordings.** If ten minutes are captured, a frame exists, so every
   surface shows it; generated art is the fallback for things with nothing captured. Data-driven
   per-card sources were dropped because they made the same item look different on two surfaces.
6. **One Go live control in the player** (the red readout pill + `End`). The transport duplicate is
   gone on desktop and phone; on phones its slot holds Mute, which lets the option chips fit one
   row (the "Sound" chip is gone).
7. **Speed ETA hidden after the window end** rather than "catches up after the end": the quiet
   line should state facts, and there is no live to reach after the recording ends.
8. **Kids access is by destination.** Scheduled items and rules count as the collection they record
   into. Other non-admin profiles see other people's rules read-only rather than not at all, so a
   household knows what is being recorded.
9. **Guide now line** stays behind opaque cells; the elapsed tint ends at now and visually
   continues it. Spec text updated instead of removing the tint (it is what makes "on now" read
   stronger than "ended").
10. **Short landscape guide keeps the grid** (with one header row and no mini player) rather than
    switching to Channels: the person rotated the phone to see more of the grid.
11. **Hero title steps down in size before truncating**, inside a fixed line box, so geometry is
    still identical across states.
12. **Phone hero button keeps the time** ("Resume 18:11"), matching the choice dialog.
13. **Offline banner is neutral glass with an orange icon**: red stays reserved for live and
    recording.
14. **Reviewer suggestion not taken:** making the hero art a ~120 px band at half snap (see 4) and
    defaulting short landscape to the Channels view (see 10).


## Decisions (round 3 review)

1. **Phone hero: Live folds to an icon button, nothing wraps.** Three reviewers proposed wrapping,
   dropping Live, or moving it into the read line. Wrapping would make the hero's action row
   taller in one state (geometry must match in all five), and dropping Live hides the most direct
   way in. So under 600 px Live is a 48 px round glass button with a red live glyph and a label for
   assistive tech; "Resume 18:11" stays whole and From start takes the rest. The overflow check now
   runs in `isMobile` contexts and compares against `clientWidth`.
2. **Mini player on Home is decided per route render**, from every item the hero can show (all
   switcher tabs, or the idle hero's item), not from the selected tab. It never pops in or out
   when switching tabs. On Jonas's default Home it is therefore hidden (Qualifying is a hero tab).
3. **Continue watching = has a resume position for this profile.** That fixes Kids' Maus showing
   in Continue *and* New with a new dot. The hero's own item is left out of the row under it
   (accepting a duplicate was the alternative; the owner wants consistent, non-repeating rows).
   Kids' Shaun das Schaf got a 60 % position so the row isn't empty in the demo.
4. **Collection-limited profiles record only into their own collection**, and a programme already
   scheduled for the household is shown as such with no second capture. Hiding the Record option
   entirely for Kids was rejected: recording KiKA programmes is the point of the Kids profile.
5. **Initial focus follows input modality.** Keyboard opens land on the first control (unchanged
   behaviour for keyboard users); tap, click and deep links focus the overlay container, so phones
   never show a ring on Watch or Close. Invite focuses Name from the keyboard, never Close.
6. **Esc closes the innermost layer** and inline steps are forms (Enter confirms). One rule for
   the player panel, inline steps, menus and sheets.
7. **Guide views are "Timeline | Channels" everywhere**, in that order. "Grid" says nothing to a
   viewer; one order means the control never flips when the window crosses 768 px. The phone
   default stays Channels (the second segment is pressed).
8. **Guide grid semantics: channel in the label, `region` container** instead of a full ARIA grid
   with rowheaders. The cells are buttons with roving focus already; a half-built `role=grid` was
   worse than none. Channel-first labels give the row change on ↑/↓.
9. **One scroller on the guide from 768 px** by sizing the grid to the remaining viewport (the
   build does this with a flex column and `min-height: 0`; the prototype measures). The `main`
   bottom padding from 768 px dropped from 64 to 32 px + `--mini-h`, which also stops the mini
   player covering the last row and the legend at 768×1024.
10. **Desktop player: the transport timecode is gone**; the read-out sub-line ("playing 18:42:03 ·
    live 18:42") is the one place for the time.
11. **Day notation is the pills' everywhere** ("Today 21", "Sun 22"), including the short-landscape
    day menu, instead of "Tomorrow" / "Mon 23 Nov".
12. **Skeleton neutrality** extends to selection from data (hero tab bar), state tints (conflict)
    and ellipsis glyphs.
13. **Add profile is the fourth card** in the profile row; the header button is gone (one place to
    add, the row fills the width).
14. **Short landscape**: the drawer art band is 88 px (spec and build agree; the facts line now
    clears the footer); the guide's channel column shows logo only; Recordings drops the storage
    meter and puts tools in one row; the mini player drops the event suffix (as on phones).
15. **The live half snap includes the timeline** when one follows the facts, rather than shaving
    the snap by a few px: the halo can't peek out, and the sheet shows where live is at half.
16. **Kids frame stand-ins vary** (three times of day, kid and kite position, no lime kite), the way
    the F1 frames vary, so one profile's Home doesn't repeat one picture.
17. **Not changed:**
    - *Offline banner over the hero switcher* stays an overlay. Pushing the switcher down while
      offline would move content when the connection drops (owner point 2); the banner is
      temporary and the tabs remain reachable.
    - *Hero "one recording" band under the top bar* stays: nudging the content up only when there
      is no switcher would give the states different geometry (owner point 17). The band carries
      the blurred art already.
    - *Mini player over the Scheduled conflict block while scrolling*: `main` reserves `--mini-h`
      at the bottom, so the last row is always reachable above it; covering a row mid-scroll is
      how a floating player works everywhere (Spotify, YouTube) and is accepted.
    - *Channel logo luminance*: kept white on brand colours as decorative logotype (§10); real
      logos replace the chips in the build.
