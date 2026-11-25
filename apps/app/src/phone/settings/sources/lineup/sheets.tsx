import { type Channel, type ChannelId, parseLineupNumber } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Text, View } from "react-native";
import { useSession } from "../../../../session/session-context.ts";
import { useTheme } from "../../../../theme/theme.ts";
import { FocusButton } from "../../../../ui/FocusButton.tsx";
import { Sheet, SheetTitle } from "../../../../ui/Sheet.tsx";
import { TextField } from "../../../../ui/TextField.tsx";
import { useToast } from "../../../../ui/toast.ts";
import { useRefreshAfterChange } from "../use-sources.ts";
import { numberMoveText } from "./number-text.ts";
import { lineupActions, useLineupQueries } from "./queries.ts";

/** A quiet line of text in a sheet. */
const Note = ({
  text,
  tone = "default",
}: {
  readonly text: string;
  readonly tone?: "default" | "warn";
}) => {
  const { colors, em, fonts } = useTheme();
  return (
    <Text
      style={{
        fontFamily: fonts.fUi,
        fontSize: 0.92 * em,
        color: tone === "warn" ? colors.warnText : colors.fg2,
      }}
    >
      {text}
    </Text>
  );
};

/** The sheet's buttons at its end: Cancel and the one action. */
const SheetActions = ({
  action,
  busy,
  disabled = false,
  onAction,
  onClose,
}: {
  readonly action: string;
  readonly busy: boolean;
  readonly disabled?: boolean;
  readonly onAction: () => void;
  readonly onClose: () => void;
}) => {
  const { em } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "flex-end",
        gap: 0.6 * em,
        paddingTop: 0.4 * em,
      }}
    >
      <FocusButton label={m.action_cancel()} variant="ghost" onPress={onClose} />
      <FocusButton
        label={action}
        variant="primary"
        disabled={busy || disabled}
        onPress={onAction}
      />
    </View>
  );
};

/**
 * Typing a number for one or several channels (in their order): the line under the field says
 * what happens before anything is saved ("Move to 6 · VOX HD moves to 7"); the holder of a
 * taken number moves to the next free one and nothing else is renumbered.
 */
export const NumberSheet = ({
  lineup,
  ids,
  onDone,
  onClose,
}: {
  readonly lineup: readonly Channel[];
  readonly ids: readonly ChannelId[];
  readonly onDone?: () => void;
  readonly onClose: () => void;
}) => {
  const { em } = useTheme();
  const { runAction } = useSession();
  const toast = useToast();
  const refreshAfter = useRefreshAfterChange();
  const current =
    ids.length === 1 ? lineup.find((channel) => channel.id === ids[0])?.number : undefined;
  const [text, setText] = useState(current === undefined ? "" : String(current));
  const [busy, setBusy] = useState(false);
  const number = parseLineupNumber(text);
  const save = () => {
    if (number === undefined || busy) return;
    setBusy(true);
    const [only] = ids;
    const write =
      ids.length === 1 && only !== undefined
        ? lineupActions.setNumber(only, number)
        : lineupActions.placeNumbers(ids, number);
    runAction(write)
      .then(() => refreshAfter("channels"))
      .then(() => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onDone?.();
        onClose();
      })
      .catch(() => {
        toast({ text: m.state_not_saved() });
        setBusy(false);
      });
  };
  return (
    <Sheet label={m.lineup_move_title({ count: ids.length })} onClose={onClose}>
      <SheetTitle>{m.lineup_move_title({ count: ids.length })}</SheetTitle>
      <View style={{ gap: 0.4 * em }}>
        <TextField
          label={m.lineup_number_field()}
          value={text}
          onChangeText={setText}
          keyboardType="number-pad"
          returnKeyType="done"
          onSubmitEditing={save}
          autoFocus
          inSheet
          invalid={text.trim() !== "" && number === undefined}
        />
        {/* One line kept for the preview or the problem, so neither moves the buttons. */}
        <View style={{ minHeight: 2.6 * em }}>
          {number !== undefined ? (
            <Note text={numberMoveText(lineup, ids, number)} />
          ) : text.trim() === "" ? null : (
            <Note text={m.lineup_number_invalid()} tone="warn" />
          )}
        </View>
      </View>
      <SheetActions
        action={m.lineup_move_action()}
        busy={busy}
        disabled={number === undefined}
        onAction={save}
        onClose={onClose}
      />
    </Sheet>
  );
};

/**
 * Removing channels, confirmed gently: recordings stay, the streams go back to their source,
 * and one-off recordings still scheduled on them are cancelled (said when there are any).
 */
export const RemoveSheet = ({
  channels,
  onDone,
  onClose,
}: {
  readonly channels: readonly Channel[];
  readonly onDone: () => void;
  readonly onClose: () => void;
}) => {
  const { runAction } = useSession();
  const toast = useToast();
  const refreshAfter = useRefreshAfterChange();
  const lineup = useLineupQueries();
  const ids = channels.map((channel) => channel.id);
  const preview = useQuery(lineup.removePreview(ids));
  const [busy, setBusy] = useState(false);
  const [only] = channels;
  const title =
    channels.length === 1 && only !== undefined
      ? m.lineup_remove_named({ name: only.name })
      : m.lineup_remove_many({ count: channels.length });
  const scheduled = preview.data?.scheduledRecordings ?? 0;
  const remove = () => {
    setBusy(true);
    runAction(lineupActions.removeMany(ids))
      .then(() => refreshAfter("channels"))
      .then(() => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        toast({ text: m.lineup_removed({ count: ids.length }) });
        onDone();
        onClose();
      })
      .catch(() => {
        toast({ text: m.state_not_saved() });
        setBusy(false);
      });
  };
  return (
    <Sheet label={title} onClose={onClose}>
      <SheetTitle>{title}</SheetTitle>
      <Note text={m.lineup_remove_body()} />
      {scheduled > 0 ? (
        <Note text={m.lineup_remove_cancels({ count: scheduled })} tone="warn" />
      ) : null}
      <SheetActions
        action={m.lineup_remove()}
        // Wait for the count, so the sentence about cancelled recordings is never missed.
        busy={busy || preview.isPending}
        onAction={remove}
        onClose={onClose}
      />
    </Sheet>
  );
};
