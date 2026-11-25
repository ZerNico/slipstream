import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useTheme } from "../theme/theme.ts";
import { FocusButton } from "./FocusButton.tsx";
import { type Toast, ToastContext, toastMillis } from "./toast.ts";

/**
 * A notice over every screen: a toast at the bottom edge, a reminder at the top. One line of
 * text and, off TV, one action. On TV a notice never takes focus: it would leave the guide's
 * focus stranded when it goes. A TV screen keeps its action in a focused row of its own (the
 * record sheet's Undo), so a notice there only says what happened.
 */
export const NoticeFrame = ({
  edge,
  text,
  action,
  onAction,
}: {
  readonly edge: "top" | "bottom";
  readonly text: string;
  readonly action?: { readonly label: string; readonly onPress: () => void } | undefined;
  /** Runs before the action's own press (the toast leaves). */
  readonly onAction?: (() => void) | undefined;
}) => {
  const { colors, em, fonts, radii, isTV } = useTheme();
  const inset = (isTV ? 2.7 : 3) * em;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        position: "absolute",
        top: edge === "top" ? inset : undefined,
        bottom: edge === "bottom" ? inset : undefined,
        right: (isTV ? 4 : 1) * em,
        left: isTV ? undefined : em,
        zIndex: edge === "bottom" ? 30 : 20,
        flexDirection: "row",
        alignItems: "center",
        gap: em,
        padding: em,
        borderRadius: radii.rL,
        backgroundColor: colors.raised,
        borderWidth: 1,
        borderColor: colors.line,
      }}
    >
      <Text
        style={{
          flexShrink: 1,
          fontFamily: fonts.fUiSemiBold,
          fontSize: (isTV ? 1.2 : 1) * em,
          color: colors.fg,
        }}
      >
        {text}
      </Text>
      {action === undefined || isTV ? null : (
        <FocusButton
          label={action.label}
          onPress={() => {
            onAction?.();
            action.onPress();
          }}
        />
      )}
    </View>
  );
};

/**
 * Shows the toasts screens and live events ask for (`useToast`), one at a time; a new one
 * replaces the one on screen. Each leaves by itself after `toastMillis`.
 */
export const ToastHost = ({ children }: { readonly children: ReactNode }) => {
  const [toast, setToast] = useState<Toast | undefined>(undefined);
  const clear = useCallback(() => setToast(undefined), []);
  useEffect(() => {
    if (toast === undefined) return;
    const timer = setTimeout(clear, toastMillis(toast));
    return () => clearTimeout(timer);
  }, [toast, clear]);
  return (
    <ToastContext value={setToast}>
      {children}
      {toast === undefined ? null : (
        <NoticeFrame edge="bottom" text={toast.text} action={toast.action} onAction={clear} />
      )}
    </ToastContext>
  );
};
