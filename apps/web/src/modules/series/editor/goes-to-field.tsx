import {
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type ChannelId,
  type Collection,
  CollectionId,
  type CollectionOffer,
  type GoesToOptions,
  newSeriesCollection,
  type RuleId,
} from "@slipstream/domain";
import {
  useCreateCollection,
  useCreateSeriesCollection,
  useUndoSeriesCollection,
} from "~/api/mutations.ts";
import { m } from "@slipstream/i18n";
import { announce } from "~/ui/announce-store.ts";
import { Icon } from "~/ui/icon.tsx";
import { CheckIcon } from "~/ui/icons.ts";
import { Button } from "~/ui/primitives/button.tsx";
import { Input } from "~/ui/primitives/input.tsx";
import { toast } from "~/ui/toast-manager.ts";
import { Select } from "~/ui/primitives/select.tsx";

const automatic = "automatic";
const newOne = "new";

/** What a new collection made inline holds, besides its name. */
export interface NewCollectionScope {
  readonly name: string;
  /**
   * A programme the series recording matches (the first in its preview), else its title start:
   * the collection keys on its title the way "Record every…" does.
   */
  readonly title: string | undefined;
  /** Its one channel; undefined when it records on several or any, then so does the collection. */
  readonly channel: { readonly id: ChannelId; readonly name: string } | undefined;
}

/**
 * The inline step around a name field (SPEC §7.3, §8.3): its own form under the select, the
 * name prefilled and selected so typing replaces it, Enter submits, Esc cancels only the step.
 */
function InlineStep({
  label,
  initialName,
  submit,
  cancel,
  busy,
  onSubmit,
  onCancel,
}: {
  label: string;
  initialName: string;
  submit: string;
  cancel: string;
  busy: boolean;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    // Typing replaces the prefill instead of prepending to it (open issue 6).
    input.current?.select();
  }, []);
  const send = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim() || initialName.trim();
    if (trimmed !== "") onSubmit(trimmed);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    // Esc closes the innermost layer only: the step, never the page or a dialog around it.
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  };
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Esc inside the step cancels the step
    <form
      noValidate
      onSubmit={send}
      onKeyDown={onKeyDown}
      className="-mx-5 -mb-5 grid gap-3 border-t border-line bg-hover px-4 py-3.5"
    >
      <div className="field">
        <label className="field-label" htmlFor="rule-new-collection">
          {label}
        </label>
        <Input
          id="rule-new-collection"
          ref={input}
          value={name}
          autoComplete="off"
          enterKeyHint="done"
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          busy={busy}
          icon={<Icon icon={CheckIcon} size={16} />}
        >
          {submit}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {cancel}
        </Button>
      </div>
    </form>
  );
}

/**
 * The inline "New collection…" step (SPEC §7.3, §8.3): a collection of its own, keyed on the
 * series recording's channel and title start by the domain's `seriesCollection`, so it holds what
 * "Record every…" would. Focus goes back to the select either way.
 */
export function NewCollectionStep({
  scope,
  onCreated,
  onCancel,
}: {
  scope: NewCollectionScope;
  onCreated: (collection: Collection) => void;
  onCancel: () => void;
}) {
  const create = useCreateCollection();
  return (
    <InlineStep
      label={m.library_new_collection()}
      initialName={scope.name}
      submit={m.series_nc_create()}
      cancel={m.action_cancel()}
      busy={create.isPending}
      onCancel={onCancel}
      onSubmit={(name) =>
        create.mutate(
          newSeriesCollection(name, { title: scope.title, channelId: scope.channel?.id }),
          {
            onSuccess: (collection) => {
              announce(m.series_nc_announce({ name: collection.name }));
              toast({
                title: m.series_nc_created(),
                description: collection.name,
                alreadyAnnounced: true,
              });
              onCreated(collection);
            },
            onError: () => toast({ title: m.series_nc_failed(), type: "error" }),
          },
        )
      }
    />
  );
}

/**
 * "Group them in a collection" (recording model §3.3): the offer step in the editor. The name
 * comes from the offer and is selected; a line shows where things would land. *Group them* makes
 * a collection that follows this series recording; the toast offers Undo.
 */
export function GroupStep({
  ruleId,
  offer,
  onGrouped,
  onUngrouped,
  onCancel,
}: {
  ruleId: RuleId;
  offer: CollectionOffer;
  onGrouped: (collection: Collection) => void;
  onUngrouped: () => void;
  onCancel: () => void;
}) {
  const group = useCreateSeriesCollection();
  const undo = useUndoSeriesCollection();
  return (
    <InlineStep
      label={m.offer_name()}
      initialName={offer.name}
      submit={m.offer_group()}
      cancel={m.offer_decline()}
      busy={group.isPending}
      onCancel={onCancel}
      onSubmit={(name) =>
        group.mutate(
          { ruleId, request: { name, layout: offer.layout } },
          {
            onSuccess: (collection) => {
              const done = m.offer_done({ name: collection.name });
              announce(done);
              toast({
                title: done,
                alreadyAnnounced: true,
                undo: () => undo.mutate(ruleId, { onSuccess: onUngrouped }),
              });
              onGrouped(collection);
            },
            onError: () => toast({ title: m.series_nc_failed(), type: "error" }),
          },
        )
      }
    />
  );
}

/**
 * "Goes to" (SPEC §8.6, recording model §3.2): Automatic names today's result ("Automatic
 * (Formel 1)", or "Automatic (by title and date, 4 separate places)" when the programmes
 * scatter), then the collections this profile may record into, the one that follows this series
 * recording saying so, then "New collection…", which opens the inline step the editor renders
 * under the section. Leaving the following collection says what happens to it.
 */
export function GoesToField({
  value,
  onChange,
  options,
  allowed,
  automaticName,
  scattered,
  following,
  stepOpen,
  onStep,
  selectRef,
  disabled,
}: {
  value: CollectionId | undefined;
  onChange: (value: CollectionId | undefined) => void;
  options: GoesToOptions | undefined;
  /** What may be picked: what the profile may record into, the picked and the following one. */
  allowed: readonly Collection[];
  automaticName: string | undefined;
  /** In how many places Automatic would scatter the programmes, when it would. */
  scattered: number | undefined;
  /** The collection that follows this series recording. */
  following: Collection | undefined;
  stepOpen: boolean;
  onStep: (open: boolean) => void;
  selectRef: RefObject<HTMLButtonElement | null>;
  disabled: boolean;
}) {
  return (
    <div className="field">
      <label className="field-label" htmlFor="rule-collection">
        {m.library_kind_collection()}
      </label>
      <Select
        id="rule-collection"
        ref={selectRef}
        disabled={disabled}
        value={stepOpen ? newOne : (value ?? automatic)}
        onChange={(next) => {
          if (next === newOne) {
            onStep(true);
            return;
          }
          onStep(false);
          onChange(next === automatic ? undefined : CollectionId.make(next));
        }}
        options={[
          ...(options?.automatic === false
            ? []
            : [
                {
                  value: automatic,
                  label:
                    scattered !== undefined
                      ? m.series_goes_scattered({ count: scattered })
                      : automaticName === undefined
                        ? m.series_automatic()
                        : m.series_automatic_named({ name: automaticName }),
                },
              ]),
          ...allowed.map((collection) => ({
            value: collection.id as string,
            label:
              collection.id === following?.id
                ? m.series_goes_follows({ collection: collection.name })
                : collection.name,
          })),
          ...(options?.newCollection === true
            ? [{ value: newOne, label: m.series_new_collection() }]
            : []),
        ]}
      />
    </div>
  );
}
