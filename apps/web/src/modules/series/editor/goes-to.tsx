import { useRef, useState } from "react";
import {
  type ChannelId,
  type Collection,
  type CollectionId,
  type CollectionOffer,
  collectionNameFor,
  type GoesToOptions,
  keepKinds,
  type Programme,
  type RuleId,
  type SeriesDraft,
  titlePrefix,
} from "@slipstream/domain";
import { m, seriesKeepKindLabel } from "@slipstream/i18n";
import { Select } from "~/ui/primitives/select.tsx";
import { Icon } from "~/ui/icon.tsx";
import { AddIcon } from "~/ui/icons.ts";
import { Button } from "~/ui/primitives/button.tsx";
import { Input } from "~/ui/primitives/input.tsx";
import { FormSection } from "~/ui/form-section.tsx";
import type { UpdateDraft } from "./form.tsx";
import { GoesToField, GroupStep, NewCollectionStep } from "./goes-to-field.tsx";

/**
 * Section 6, "Goes to & keep": the collection it records into (or automatic groups), the inline
 * New collection and Group steps, and how many it keeps.
 */
export function GoesToSection({
  draft,
  update,
  editable,
  options,
  allowed,
  automaticName,
  offer,
  following,
  groupRuleId,
  firstMatch,
  channelName,
  onLinked,
}: {
  draft: SeriesDraft;
  update: UpdateDraft;
  editable: boolean;
  options: GoesToOptions | undefined;
  /** The collections it may pick (`goesToView`). */
  allowed: readonly Collection[];
  /** Where Automatic puts the first match ("Live F1"), when the preview knows. */
  automaticName: string | undefined;
  /** "Group these as …": the matches scatter and the draft has no collection. */
  offer: CollectionOffer | undefined;
  /** The collection that follows this series recording (§3.4). */
  following: Collection | undefined;
  /** The saved series recording that may be grouped now; undefined when it may not. */
  groupRuleId: RuleId | undefined;
  /** The first programme it would record, for the steps' examples. */
  firstMatch: Programme | undefined;
  channelName: (id: ChannelId) => string | undefined;
  /** Grouping saved the collection on the series recording already (or undid it). */
  onLinked: (collectionId: CollectionId | undefined) => void;
}) {
  const [step, setStep] = useState<"none" | "new" | "group">("none");
  const selectRef = useRef<HTMLButtonElement>(null);
  const closeStep = () => {
    setStep("none");
    selectRef.current?.focus();
  };
  const firstChannel = draft.channels[0];
  const oneChannel =
    firstChannel === undefined || draft.channels.length > 1
      ? undefined
      : { id: firstChannel, name: channelName(firstChannel) ?? firstChannel };
  return (
    <FormSection title={m.series_section_goes()}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid content-start gap-1.5">
          <GoesToField
            value={draft.collectionId}
            onChange={(collectionId) => update({ collectionId })}
            options={options}
            allowed={allowed}
            automaticName={automaticName}
            scattered={offer?.groups}
            following={following}
            stepOpen={step === "new"}
            onStep={(open) => setStep(open ? "new" : "none")}
            selectRef={selectRef}
            disabled={!editable}
          />
          {groupRuleId !== undefined && offer !== undefined && step !== "group" ? (
            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon={<Icon icon={AddIcon} size={16} />}
                onClick={() => setStep("group")}
              >
                {m.series_goes_group()}
              </Button>
            </div>
          ) : null}
        </div>
        <div className="field">
          <label className="field-label" htmlFor="rule-keep">
            {m.library_editor_keep()}
          </label>
          <div className="flex gap-2">
            <Select
              id="rule-keep"
              className="flex-1"
              value={draft.keep}
              options={keepKinds.map((kind) => ({ value: kind, label: seriesKeepKindLabel(kind) }))}
              onChange={(keep) => update({ keep })}
            />
            {draft.keep === "KeepAll" ? null : (
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                aria-label={
                  draft.keep === "KeepDays" ? m.series_keep_days() : m.series_keep_count()
                }
                value={draft.keepCount}
                className="w-20 shrink-0 tabular-nums"
                onChange={(event) => update({ keepCount: Number(event.target.value) })}
              />
            )}
          </div>
        </div>
      </div>
      {step === "new" ? (
        <NewCollectionStep
          scope={{
            name: collectionNameFor(draft),
            title: firstMatch?.title ?? titlePrefix(draft),
            channel: oneChannel,
          }}
          onCancel={closeStep}
          onCreated={(collection) => {
            update({ collectionId: collection.id });
            closeStep();
          }}
        />
      ) : null}
      {step === "group" && offer !== undefined && groupRuleId !== undefined ? (
        <GroupStep
          ruleId={groupRuleId}
          offer={offer}
          onCancel={closeStep}
          onGrouped={(collection) => {
            // Saved already: the series recording records into it from now on.
            onLinked(collection.id);
            closeStep();
          }}
          onUngrouped={() => onLinked(undefined)}
        />
      ) : null}
    </FormSection>
  );
}
