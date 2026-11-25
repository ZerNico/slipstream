# apps/app/src

One app for phone and Android TV. Each screen picks its platform at the route
(`Platform.isTV ? <Tv… /> : <Phone… />`); everything else is shared.

| Folder           | Holds                                                                                |
| ---------------- | ------------------------------------------------------------------------------------ |
| `phone/`         | Phone-only screens and their parts                                                   |
| `tv/`            | TV-only screens and their parts (rail, focus, remote)                                |
| `tv/guide/core/` | The TV guide's pure model: imports only `effect`, the domain and itself              |
| everything else  | Shared by both: `api`, `data`, `recordings`, `record`, `series`, `player`, `ui`, ... |

Boundaries (lint errors, `oxlint.config.ts`):

- `phone/` never imports `tv/`, and `tv/` never imports `phone/`. Code both need moves to a
  shared folder: hooks to `data/`, `recordings/` or `series/`, components to `ui/`, links to
  `routes.ts`.
- Shared folders may import either side when they render per platform (the settings screen
  draws the TV rail on TV).
- `tv/guide/core/` is pure, so shared code may read its types and helpers too (`data/guide-data.ts`
  builds the guide model both guides draw, `player/controls.ts` reuses its hold logic).
- Every query key is in `api/keys.ts`, every read in `api/queries.ts`, every failure is read by
  `api/failure.ts`.
