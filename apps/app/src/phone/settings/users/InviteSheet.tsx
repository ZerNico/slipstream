import type { GuestInvite } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Text } from "react-native";
import { useSession } from "../../../session/session-context.ts";
import { useTheme } from "../../../theme/theme.ts";
import { OptionRow } from "../../../ui/OptionRow.tsx";
import { Sheet, SheetTitle } from "../../../ui/Sheet.tsx";
import { useToast } from "../../../ui/toast.ts";
import { shareLink, usersActions, useRefreshHousehold } from "./api.ts";

/**
 * A pending invite's sheet: who it is for and what it grants, Share link (the system share
 * sheet, which also copies) and Revoke, which stops the link working.
 */
export const InviteSheet = ({
  invite,
  line,
  onClose,
}: {
  readonly invite: GuestInvite;
  readonly line: string;
  readonly onClose: () => void;
}) => {
  const { colors, em, fonts } = useTheme();
  const { runAction } = useSession();
  const toast = useToast();
  const refresh = useRefreshHousehold();
  const [busy, setBusy] = useState(false);
  return (
    <Sheet label={m.invite_for({ name: invite.name })} onClose={onClose}>
      <SheetTitle>{m.invite_for({ name: invite.name })}</SheetTitle>
      <Text style={{ fontFamily: fonts.fUi, fontSize: 0.92 * em, color: colors.fg2 }}>{line}</Text>
      <OptionRow title={m.invite_share()} onPress={() => void shareLink(invite.url)} />
      <OptionRow
        title={m.action_revoke()}
        hint={m.invite_revoke_named({ name: invite.name })}
        onPress={
          busy
            ? undefined
            : () => {
                setBusy(true);
                runAction(usersActions.revokeInvite(invite.id))
                  .then(async () => {
                    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    toast({ text: m.invite_revoked() });
                    await refresh();
                    onClose();
                  })
                  .catch(() => {
                    setBusy(false);
                    toast({ text: m.state_not_saved() });
                  });
              }
        }
      />
    </Sheet>
  );
};
