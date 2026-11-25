import { createFileRoute } from "@tanstack/react-router";
import { m } from "@slipstream/i18n";
import { GuidePage } from "~/modules/guide/guide-page.tsx";
import { compact, optionalEnum, optionalString } from "~/shell/search.ts";

/**
 * The guide (SPEC §8.2): Timeline and Channels views, day pills, categories, the programme
 * sheet. Search: `view`, `day`, `cat`, `at`.
 */
export const Route = createFileRoute("/_app/guide")({
  validateSearch: (search: Record<string, unknown>) =>
    compact({
      view: optionalEnum(search["view"], ["timeline", "channels"] as const),
      day: optionalString(search["day"]),
      cat: optionalString(search["cat"]),
      at: optionalString(search["at"]),
    }),
  staticData: { skipLabel: () => m.guide_skip(), noMini: "short" },
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <GuidePage
      search={search}
      onSearch={(patch) => {
        void navigate({
          search: (previous) => compact({ ...previous, ...patch }),
          replace: true,
          resetScroll: false,
        });
      }}
    />
  );
}
