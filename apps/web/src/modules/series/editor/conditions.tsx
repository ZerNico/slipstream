import {
  type ConditionDraft,
  conditionKinds,
  type DraftProblem,
  newCondition,
  type SeriesDraft,
} from "@slipstream/domain";
import { m, seriesConditionKindLabel } from "@slipstream/i18n";
import { TokenField } from "~/ui/form-controls.tsx";
import { Select } from "~/ui/primitives/select.tsx";
import { Icon } from "~/ui/icon.tsx";
import { AddIcon, DeleteIcon, WarningIcon } from "~/ui/icons.ts";
import { Button, IconButton } from "~/ui/primitives/button.tsx";
import { Input } from "~/ui/primitives/input.tsx";
import { FormSection } from "~/ui/form-section.tsx";
import type { UpdateDraft } from "./form.tsx";

/** Section 2, "What it records": the title and category conditions. */
export function ConditionsSection({
  draft,
  update,
  editable,
  problems,
  showProblems,
}: {
  draft: SeriesDraft;
  update: UpdateDraft;
  editable: boolean;
  problems: readonly DraftProblem[];
  /** Saving was tried: problems are shown, not only blocking. */
  showProblems: boolean;
}) {
  const setCondition = (key: number, patch: Partial<ConditionDraft>) =>
    update({
      conditions: draft.conditions.map((condition) =>
        condition.key === key ? { ...condition, ...patch } : condition,
      ),
    });
  const matcherProblem = showProblems
    ? problems.find((problem) => problem.field === "matcher")
    : undefined;
  const regexProblem = (index: number) =>
    problems.find((problem) => problem.field === "condition" && problem.index === index);
  return (
    <FormSection title={m.series_section_conditions()}>
      {draft.conditions.map((condition, index) => {
        const broken = regexProblem(index);
        return (
          <div
            key={condition.key}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 sm:grid-cols-[180px_minmax(0,1fr)_auto]"
          >
            <Select
              aria-label={m.series_condition()}
              value={condition.kind}
              options={conditionKinds.map((kind) => ({
                value: kind,
                label: seriesConditionKindLabel(kind),
              }))}
              onChange={(kind) => setCondition(condition.key, { kind })}
            />
            <div className="col-span-full row-start-2 grid gap-1.5 sm:col-span-1 sm:row-start-auto">
              {condition.kind === "Regex" ? (
                <Input
                  aria-label={m.series_pattern()}
                  value={condition.pattern}
                  placeholder={m.series_pattern_placeholder()}
                  aria-invalid={broken !== undefined || undefined}
                  onChange={(event) => setCondition(condition.key, { pattern: event.target.value })}
                />
              ) : (
                <TokenField
                  label={m.series_condition_values()}
                  values={condition.values}
                  disabled={!editable}
                  onChange={(values) => setCondition(condition.key, { values })}
                />
              )}
              {broken === undefined || broken.field !== "condition" ? null : (
                <span className="field-error" role="alert">
                  <Icon icon={WarningIcon} size={16} />
                  {m.series_problem_regex({ pattern: broken.pattern })}
                </span>
              )}
            </div>
            <IconButton
              label={m.series_remove_condition()}
              onClick={() =>
                update({
                  conditions: draft.conditions.filter((item) => item.key !== condition.key),
                })
              }
            >
              <Icon icon={DeleteIcon} size={16} />
            </IconButton>
          </div>
        );
      })}
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={<Icon icon={AddIcon} size={16} />}
          onClick={() =>
            update({
              conditions: [...draft.conditions, newCondition(draft.conditions, "Contains")],
            })
          }
        >
          {m.series_add_condition()}
        </Button>
      </div>
      {matcherProblem === undefined ? null : (
        <span className="field-error" role="alert">
          <Icon icon={WarningIcon} size={16} />
          {matcherProblem.kind === "everything"
            ? m.series_problem_everything()
            : m.series_problem_duration()}
        </span>
      )}
    </FormSection>
  );
}
