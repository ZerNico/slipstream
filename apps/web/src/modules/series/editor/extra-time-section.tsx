import type { ExtraTimeHint } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { MinutesSelect } from "~/ui/minutes-select.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { FormSection } from "~/ui/form-section.tsx";
import type { UpdateDraft } from "./form.tsx";

/** "Extra time": start early and end late, and Reset when this series differs from the default. */
export function ExtraTimeSection({
  extra,
  update,
  editable,
}: {
  /** What the draft records with and whether it differs from the default (`draftExtraTime`). */
  extra: ExtraTimeHint;
  update: UpdateDraft;
  editable: boolean;
}) {
  return (
    <FormSection title={m.series_section_extra()}>
      <div className="grid gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3 text-[14px]">
          <span>{m.padding_before()}</span>
          <MinutesSelect
            label={m.padding_before()}
            side="early"
            value={extra.padding.beforeMinutes}
            text={(minutes) => m.series_minutes({ minutes })}
            disabled={!editable}
            onChange={(beforeMinutes) => update({ padding: { ...extra.padding, beforeMinutes } })}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 text-[14px]">
          <span>{m.padding_after()}</span>
          <MinutesSelect
            label={m.padding_after()}
            side="late"
            value={extra.padding.afterMinutes}
            text={(minutes) => m.series_minutes({ minutes })}
            disabled={!editable}
            onChange={(afterMinutes) => update({ padding: { ...extra.padding, afterMinutes } })}
          />
        </div>
      </div>
      {extra.overridesDefault && editable ? (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => update({ padding: undefined })}
          >
            {m.action_reset()}
          </Button>
        </div>
      ) : null}
    </FormSection>
  );
}
