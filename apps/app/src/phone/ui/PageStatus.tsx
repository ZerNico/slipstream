import { m } from "@slipstream/i18n";
import type { ReactNode } from "react";
import { View } from "react-native";
import { useSession } from "../../session/session-context.ts";
import { useTheme } from "../../theme/theme.ts";
import { FocusButton } from "../../ui/FocusButton.tsx";
import { StatusScreen } from "../../ui/StatusScreen.tsx";
import { BackHeader } from "../BackHeader.tsx";

/**
 * A pushed page that says one thing (not found, could not load, only admins) under its header,
 * so Back stays in reach; with `onRetry`, Try again under the words. Every phone page says it
 * this way.
 */
export const PageStatus = ({
  heading,
  title,
  onRetry,
}: {
  /** The page's own title in the header, when it has one. */
  readonly heading?: string | undefined;
  readonly title: string;
  readonly onRetry?: (() => void) | undefined;
}) => {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {heading === undefined ? <BackHeader /> : <BackHeader title={heading} />}
      {/* The status fills the room under the header, not the whole screen. */}
      <View style={{ flex: 1 }}>
        <StatusScreen
          title={title}
          actions={
            onRetry === undefined ? undefined : (
              <FocusButton label={m.action_try_again()} onPress={onRetry} />
            )
          }
        />
      </View>
    </View>
  );
};

/**
 * The one gate of the admin pages: the page (and every read it makes) only for an admin; anyone
 * else who reaches it by a link reads that only admins can see it. Settings lists these pages
 * for admins only.
 */
export const AdminOnly = ({
  heading,
  children,
}: {
  readonly heading: string;
  readonly children: ReactNode;
}) => {
  const { account } = useSession();
  if (account?.role === "admin") return children;
  return <PageStatus heading={heading} title={m.state_forbidden()} />;
};
