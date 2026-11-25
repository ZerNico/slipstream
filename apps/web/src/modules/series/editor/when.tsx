import { m } from "@slipstream/i18n";
import { WeekdayPills } from "~/ui/form-controls.tsx";
import type { SeriesDraft } from "@slipstream/domain";
import { FormSection } from "~/ui/form-section.tsx";
import type { UpdateDraft } from "./form.tsx";

/** Section 3, "When": the weekdays it records on. */
export function WhenSection({
  draft,
  update,
  editable,
}: {
  draft: SeriesDraft;
  update: UpdateDraft;
  editable: boolean;
}) {
  return (
    <FormSection title={m.series_section_when()}>
      <WeekdayPills
        label={m.series_weekdays()}
        value={draft.weekdays}
        disabled={!editable}
        onChange={(weekdays) => update({ weekdays })}
      />
    </FormSection>
  );
}
