import {
  type Channel,
  type ChannelId,
  type Collection,
  type CollectionId,
  type ConditionKind,
  conditionKinds,
  type KeepKind,
  keepKinds,
  Weekday,
} from "@slipstream/domain";
import { m, seriesConditionKindLabel, seriesKeepKindLabel } from "@slipstream/i18n";
import * as Haptics from "expo-haptics";
import { OptionRow } from "../ui/OptionRow.tsx";
import { FocusButton } from "../ui/FocusButton.tsx";
import { PickerSheet } from "../ui/PickerSheet.tsx";
import { Sheet, SheetTitle } from "../ui/Sheet.tsx";

/*
 * The editor's pickers, each a bottom sheet of option rows: channels and weekdays pick several
 * (ticks, Close when done), a condition's kind, keep and the collection pick one and close.
 */

const toggle = <A,>(list: readonly A[], item: A): readonly A[] =>
  list.includes(item) ? list.filter((candidate) => candidate !== item) : [...list, item];

/** Channels: "Any channel", or any number of the channels this profile may pick. */
export const ChannelSheet = ({
  channels,
  value,
  onChange,
  onClose,
}: {
  readonly channels: readonly Channel[];
  readonly value: readonly ChannelId[];
  readonly onChange: (value: readonly ChannelId[]) => void;
  readonly onClose: () => void;
}) => (
  <Sheet label={m.channels_heading()} onClose={onClose}>
    <SheetTitle>{m.channels_heading()}</SheetTitle>
    <OptionRow
      title={m.series_any_channel()}
      selected={value.length === 0}
      onPress={() => {
        void Haptics.selectionAsync();
        onChange([]);
      }}
    />
    {channels.map((channel) => (
      <OptionRow
        key={channel.id}
        title={channel.name}
        selected={value.includes(channel.id)}
        onPress={() => {
          void Haptics.selectionAsync();
          onChange(toggle(value, channel.id));
        }}
      />
    ))}
    <FocusButton label={m.action_close()} variant="primary" onPress={onClose} />
  </Sheet>
);

/** Weekdays: none is every day; the picked ones are kept Monday first. */
export const WeekdaySheet = ({
  value,
  onChange,
  onClose,
}: {
  readonly value: readonly Weekday[];
  readonly onChange: (value: readonly Weekday[]) => void;
  readonly onClose: () => void;
}) => (
  <Sheet label={m.series_weekdays()} onClose={onClose}>
    <SheetTitle>{m.series_weekdays()}</SheetTitle>
    <OptionRow
      title={m.series_phone_every_day()}
      selected={value.length === 0}
      onPress={() => {
        void Haptics.selectionAsync();
        onChange([]);
      }}
    />
    {Weekday.literals.map((day) => (
      <OptionRow
        key={day}
        title={m.weekday_long({ day })}
        selected={value.includes(day)}
        onPress={() => {
          void Haptics.selectionAsync();
          const next = toggle(value, day);
          onChange(Weekday.literals.filter((candidate) => next.includes(candidate)));
        }}
      />
    ))}
    <FocusButton label={m.action_close()} variant="primary" onPress={onClose} />
  </Sheet>
);

/** A condition's kind: starts with, contains, is exactly, category, pattern. */
export const KindSheet = ({
  value,
  onPick,
  onClose,
}: {
  readonly value: ConditionKind;
  readonly onPick: (kind: ConditionKind) => void;
  readonly onClose: () => void;
}) => (
  <PickerSheet
    title={m.series_condition()}
    choices={conditionKinds.map((kind) => ({ value: kind, label: seriesConditionKindLabel(kind) }))}
    selected={value}
    onPick={onPick}
    onClose={onClose}
  />
);

/** How long its recordings are kept. */
export const KeepSheet = ({
  value,
  onPick,
  onClose,
}: {
  readonly value: KeepKind;
  readonly onPick: (kind: KeepKind) => void;
  readonly onClose: () => void;
}) => (
  <PickerSheet
    title={m.library_editor_keep()}
    choices={keepKinds.map((kind) => ({ value: kind, label: seriesKeepKindLabel(kind) }))}
    selected={value}
    onPick={onPick}
    onClose={onClose}
  />
);

/** What Goes to picks: Automatic, a collection, or a new one. */
export type GoesToPick =
  | { readonly kind: "automatic" }
  | { readonly kind: "collection"; readonly id: CollectionId }
  | { readonly kind: "new" };

/**
 * Goes to (SPEC §8.6, recording model §3.2): Automatic, named after where today's programmes
 * land, then the collections this profile may record into (the one that follows this series
 * recording says so), then "New collection…" for those who may make one.
 */
export const CollectionSheet = ({
  value,
  automaticLabel,
  showAutomatic,
  collections,
  following,
  mayCreate,
  onPick,
  onClose,
}: {
  readonly value: CollectionId | undefined;
  readonly automaticLabel: string;
  readonly showAutomatic: boolean;
  readonly collections: readonly Collection[];
  readonly following: Collection | undefined;
  readonly mayCreate: boolean;
  readonly onPick: (pick: GoesToPick) => void;
  readonly onClose: () => void;
}) => (
  <Sheet label={m.library_kind_collection()} onClose={onClose}>
    <SheetTitle>{m.library_kind_collection()}</SheetTitle>
    {showAutomatic ? (
      <OptionRow
        title={automaticLabel}
        selected={value === undefined}
        onPress={() => onPick({ kind: "automatic" })}
      />
    ) : null}
    {collections.map((collection) => (
      <OptionRow
        key={collection.id}
        title={
          collection.id === following?.id
            ? m.series_goes_follows({ collection: collection.name })
            : collection.name
        }
        selected={collection.id === value}
        onPress={() => onPick({ kind: "collection", id: collection.id })}
      />
    ))}
    {mayCreate ? (
      <OptionRow
        icon="plus"
        title={m.series_new_collection()}
        onPress={() => onPick({ kind: "new" })}
      />
    ) : null}
  </Sheet>
);
