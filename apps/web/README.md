# @slipstream/web

The Slipstream web app: React 19, TanStack Router and Query, Tailwind v4 on the shared design
tokens, shadcn-style primitives on Base UI, hls.js. The design is
[`docs/design/web-v2/final/SPEC.md`](../../docs/design/web-v2/final/SPEC.md) (with the prototype
`index.html` next to it); the open issues the build must solve are in
[`docs/design/web-v2/IMPLEMENTATION-NOTES.md`](../../docs/design/web-v2/IMPLEMENTATION-NOTES.md).

```sh
pnpm dev:mock                      # the web app on the in-memory mock API (signed in as admin)
pnpm dev                           # web + real server + fake source
open http://127.0.0.1:<port>/dev/kitchen-sink   # every shared component (dev builds only)
```

## Layout

| Path                      | What                                                      | Owner              |
| ------------------------- | --------------------------------------------------------- | ------------------ |
| `src/routes/`             | TanStack file routes, one per SPEC §11 screen             | the screen's track |
| `src/modules/<area>/`     | A screen's components, logic and tests                    | the screen's track |
| `src/ui/`                 | Shared components (see below)                             | foundation         |
| `src/ui/primitives/`      | shadcn-generated Base UI primitives, restyled to the SPEC | foundation         |
| `src/shell/`              | App shell: bars, rail, mini player, palette, overlay host | foundation         |
| `src/styles/`             | Global CSS: layout variables, base, fonts, shell          | foundation         |
| `src/api/`                | Typed client, queries, mutations, SSE, CSRF; the mock     | shared, see below  |
| `src/api/mock/<group>.ts` | Mock handlers, one file per API group                     | per group          |
| `e2e/`                    | Playwright against a real server (`pnpm e2e`)             | shared helpers     |

Areas (module folders and message files share the names): `home`, `guide`, `watch`, `library`
(Recordings), `rules`, `settings`, `auth`, and `shell` for what every screen shares.

## Building a screen

1. **Route.** The stub is already there (`src/routes/_app/guide.tsx`, ...). Replace its component
   with your screen from `src/modules/<area>/`. Keep the route's `validateSearch` and
   `staticData` (or extend them): `{ under: true }` (page under the transparent top bar),
   `{ full: true }` (no chrome: player, auth), `{ noMini: true }` (editors),
   `{ skipLabel: () => m.guide_skip() }`.
2. **Module.** Components, hooks and pure logic in `src/modules/<area>/`, tests next to them
   (`*.test.ts` in node; `*.test.tsx` with `// @vitest-environment happy-dom` and `mount()` from
   `src/test/dom.tsx` or `renderWithApi()` from `src/test/render.tsx`).
3. **Words.** Every word in `packages/i18n/messages/web/<area>.ts`: English, German and a sample
   for every message with parameters, side by side. The type checker refuses a missing
   translation or sample; the catalogue test refuses a key that two areas define.
4. **Data.** Read with `useQueries()` and `useQuery(queries.x())`, write with the hooks in
   `src/api/mutations.ts`. New reads and writes go in `src/modules/<area>/queries.ts` (built on
   `useApi()`, extending the key tree there) rather than in the shared files.
5. **Mock.** Handlers for your API group live in `src/api/mock/<group>.ts`; shared state and
   helpers in `src/api/mock/context.ts`; fixtures in `src/api/mock/fixtures.ts` (shared: keep
   additions small and name them in your hand-over).
6. **Loading.** Wrap the route's content in `<LoadingScope loading={query.isPending}>`; wrap data
   text in `<Sk placeholder="…">`, use `<Artwork>` for pictures (it is its own placeholder), and
   `placeholderList(items, expected, make)` for lists. Never a spinner in place of content.
7. **Overlays.** Sheets and dialogs live in the URL. Global ones (`?choice=`, `?sheet=prog:`,
   `?sheet=log`, `?dlg=pin:`) are wired in `src/shell/overlay-host.tsx` to a file in your module
   (the stubs exist). Page-local ones: `const binding = useOverlayBinding("dlg", "invite")`, then
   `binding.open` and `binding.onOpenChange` on `<Sheet>` or `<Dialog>`; open with
   `useOverlay().open({ kind: "dlg", name: "invite", arg: id })`. Menus that become sheets on
   phones: `<ResponsiveMenu name="filter">`.
8. **Checks.** `pnpm --filter @slipstream/web test`, then `pnpm check`, then `pnpm verify`. In
   e2e, reuse `e2e/support/layout.ts`: `expectNoShiftOnLoad`, `expectNoShiftOn`,
   `expectNoHorizontalOverflow`, `smallTargets`, `expectOverlaysFit`.

## Shared components (`src/ui/`)

| Import                                   | What                                                                                                                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `~/ui/primitives/button.tsx`             | `Button` (primary, secondary, glass, ghost, danger, live; sm, md, lg; `busy`, `icon`), `IconButton` (`label` is the name and the tooltip; plain, outline, glass, live) |
| `~/ui/controls.tsx`                      | `Segmented`, `Chip`, `SearchField`, `Badge`, `Field`                                                                                                                   |
| `~/ui/primitives/*.tsx`                  | `Input`, `Switch`, `Checkbox`, `Kbd`, `Tabs`, `Tooltip`, the menu and dialog parts                                                                                     |
| `~/ui/menu.tsx`                          | `ResponsiveMenu`, `MenuItem` (`link` or `onSelect`), `MenuRadioGroup`, `MenuRadioItem`, `MenuSeparator`, `MenuLabel`                                                   |
| `~/ui/sheet/sheet.tsx`                   | `Sheet`: bottom sheet under 768 px (drag, snaps, pinned footer), side drawer from 768 px                                                                               |
| `~/ui/dialog.tsx`                        | `Dialog` (md 640, sm 460; sm is a bottom sheet under 600 px)                                                                                                           |
| `~/ui/overlay/use-overlay.tsx`           | `useOverlay`, `useOverlayBinding`                                                                                                                                      |
| `~/ui/toast-manager.ts`                  | `toast({ title, description, type, undo })`, `dismissToast`                                                                                                            |
| `~/ui/announce-store.ts`                 | `announce(text)`: the one polite live region                                                                                                                           |
| `~/ui/skeleton.tsx`, `skeleton-state.ts` | `LoadingScope`, `Sk`, `SkArt`; `useIsLoading`, `placeholderList`                                                                                                       |
| `~/ui/artwork/artwork.tsx`               | `Artwork`, `SourceBadge`, `ChannelLogo`; `artworkFor` in `generate.ts`                                                                                                 |
| `~/ui/timeline/timeline.tsx`             | `Timeline` (full or compact, bands, `relative`, `onSeek`); geometry in `geometry.ts`                                                                                   |
| `~/ui/watch-choice/watch-choice.tsx`     | `WatchChoice`; `choiceFor` in `options.ts`                                                                                                                             |
| `~/ui/media-row.tsx`                     | `MediaRow`, `MediaCard`                                                                                                                                                |
| `~/ui/states.tsx`                        | `EmptyState`, `ErrorState`, `ProblemCard`                                                                                                                              |
| `~/ui/page.tsx`                          | `Wrap`, `PageHeader`, `Section`, `TabLinks`, `Toolbar`                                                                                                                 |
| `~/ui/icon.tsx`, `~/ui/icons.ts`         | `Icon` and every glyph by meaning (`RecordIcon`, `GoLiveIcon`, ...)                                                                                                    |
| `~/shell/mini-player-store.ts`           | `setMiniPlayerItem` (the player sets it on close), `useSuppressMiniPlayer(ids)`                                                                                        |

## Styling rules

- Colours, type, radii, motion and control heights come from `@slipstream/design-tokens`
  (`bg-surface`, `text-fg-2`, `h-ctl-md`, `rounded-md`, `shadow-pop`, `var(--line)`). No raw
  colours. Breakpoints are only `sm` 600, `md` 768, `lg` 1100, `xl` 1400, plus the variants
  `short:` (landscape under 520 px tall, any width), `coarse:` and `fine:`.
- `data-surface="cine"` keeps a subtree dark in both themes (hero, player, mini player).
- Primitives own their look: a call site passes layout classes only (lint enforces it).
- Animate only transform, opacity and colours. Hover lives behind `(hover: hover)`.

## Files screen tracks do not edit

`src/ui/**`, `src/shell/**`, `src/styles/**`, `src/test/**`, `src/main.tsx`,
`src/routes/__root.tsx`, `src/routes/_app.tsx`,
`src/api/{client,queries,mutations,events,hooks,errors,proposed}.ts`,
`src/api/mock/{server,context,testing}.ts`, `e2e/support/**`, `vite.config.ts`, `package.json`,
`packages/design-tokens/**`, `packages/i18n/messages/web/{area,index,shell}.ts`. Propose changes
to them in the hand-over instead.
