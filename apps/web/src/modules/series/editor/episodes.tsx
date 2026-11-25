import type { RuleId, SeriesDraft } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { useForgetHistory } from "~/api/mutations.ts";
import { toast } from "~/ui/toast-manager.ts";
import { FormSection } from "~/ui/form-section.tsx";
import { RadioRow, type UpdateDraft } from "./form.tsx";
import { HistoryLine } from "./history.tsx";

/**
 * Section 5, "Episodes": only the ones you don't have yet, or every airing; and the deleted
 * episodes it keeps out, which can be forgotten.
 */
export function EpisodesSection({
  draft,
  update,
  ruleId,
  history,
}: {
  draft: SeriesDraft;
  update: UpdateDraft;
  /** The saved series recording; a new one has no history yet. */
  ruleId: RuleId | undefined;
  /** How many deleted episodes it keeps out for the viewer. */
  history: number;
}) {
  const forget = useForgetHistory();
  return (
    <FormSection title={m.series_section_episodes()}>
      <div role="radiogroup" aria-label={m.series_section_episodes()} className="grid gap-1">
        <RadioRow
          name="rule-episodes"
          checked={draft.skipRepeats}
          onSelect={() => update({ skipRepeats: true })}
          label={m.series_episodes_new()}
        />
        <RadioRow
          name="rule-episodes"
          checked={!draft.skipRepeats}
          onSelect={() => update({ skipRepeats: false })}
          label={m.series_episodes_every()}
        />
      </div>
      {history > 0 && ruleId !== undefined ? (
        <HistoryLine
          count={history}
          busy={forget.isPending}
          onForget={(onDone) =>
            forget.mutate(ruleId, {
              onSuccess: () => {
                toast({ title: m.series_history_forgotten() });
                onDone();
              },
              onError: () => toast({ title: m.library_action_failed(), type: "error" }),
            })
          }
        />
      ) : null}
    </FormSection>
  );
}
