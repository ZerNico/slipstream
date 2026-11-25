import { createFileRoute } from "@tanstack/react-router";
import { draftFromRule, previewInput, previewUntil, RuleId, toRuleInput } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { SeriesEditorPage } from "~/modules/series/series-editor.tsx";

/** Waits for a read without failing the route: the page says why one could not be read. */
const settled = (read: Promise<unknown>): Promise<void> =>
  read.then(
    () => undefined,
    () => undefined,
  );

/**
 * The series recording editor (SPEC §8.6, recording model §3.2). The rule decides the form's
 * shape (how many conditions and tokens), so the route waits for it before drawing, and for what
 * sizes the Episodes section: its episode history and its first preview (the date note), asked
 * exactly as the editor asks. Everything else loads in place as skeleton.
 */
export const Route = createFileRoute("/_app/series/$id")({
  staticData: { noMini: true },
  loader: async ({ context, params }) => {
    const id = RuleId.make(params.id);
    const { queryClient, queries } = context;
    const history = settled(queryClient.ensureQueryData(queries.ruleHistory(id)));
    const rule = await queryClient.ensureQueryData(queries.rule(id)).catch(() => undefined);
    // A saved rule carries its own extra time, so its preview needs no defaults.
    const asked =
      rule === undefined
        ? undefined
        : previewInput(toRuleInput(draftFromRule(rule), rule.padding), m.series_new());
    await Promise.all([
      history,
      asked === undefined
        ? undefined
        : settled(queryClient.prefetchQuery(queries.rulePreview(asked, previewUntil(Date.now())))),
    ]);
  },
  component: Page,
});

function Page() {
  const { id } = Route.useParams();
  return <SeriesEditorPage key={id} ruleId={RuleId.make(id)} />;
}
