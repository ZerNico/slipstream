import type { RefObject } from "react";
import type { Channel, ChannelId, SeriesDraft } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { Field } from "~/ui/controls.tsx";
import { TokenField } from "~/ui/form-controls.tsx";
import { Select } from "~/ui/primitives/select.tsx";
import { Input } from "~/ui/primitives/input.tsx";
import { FormSection } from "~/ui/form-section.tsx";
import type { UpdateDraft } from "./form.tsx";

/** Section 1, "Name & channels": the series recording's name and the channels it watches. */
export function NameChannelsSection({
  draft,
  update,
  editable,
  nameRef,
  nameProblem,
  pickable,
  channelName,
}: {
  draft: SeriesDraft;
  update: UpdateDraft;
  editable: boolean;
  nameRef: RefObject<HTMLInputElement | null>;
  /** Saving was tried without a name. */
  nameProblem: boolean;
  /** The channels this person may add (seen, and not picked yet). */
  pickable: readonly Channel[];
  channelName: (id: ChannelId) => string | undefined;
}) {
  return (
    <FormSection title={m.series_section_name()}>
      <Field
        label={m.field_name()}
        reserve
        htmlFor="rule-name"
        {...(nameProblem ? { error: m.series_problem_name() } : {})}
      >
        <Input
          id="rule-name"
          ref={nameRef}
          value={draft.name}
          placeholder={m.series_name_placeholder()}
          aria-invalid={nameProblem || undefined}
          autoComplete="off"
          onChange={(event) => update({ name: event.target.value })}
        />
      </Field>
      <div className="field">
        <span className="field-label" id="rule-channels-label">
          {m.channels_heading()}
        </span>
        <TokenField
          label={m.channels_heading()}
          values={draft.channels}
          input={false}
          disabled={!editable}
          tokenLabel={(id) => channelName(id as ChannelId) ?? id}
          onChange={(values) => update({ channels: values as ChannelId[] })}
          extra={
            <Select
              quiet
              className="flex-1"
              aria-label={m.series_add_channel()}
              placeholder={`+ ${m.series_add_channel()}`}
              value={null}
              disabled={!editable || pickable.length === 0}
              options={pickable.map((channel) => ({ value: channel.id, label: channel.name }))}
              onChange={(id) => update({ channels: [...draft.channels, id] })}
            />
          }
        />
      </div>
    </FormSection>
  );
}
