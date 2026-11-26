import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { BackHandler, ScrollView, StyleSheet, Text, TVFocusGuideView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/theme.ts";

interface SheetProps {
  /** What a screen reader calls the sheet. */
  readonly label: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

/** A sheet's own heading, when it says what it picks or does: the same size on every sheet. */
export const SheetTitle = ({ children }: { readonly children: string }) => {
  const { colors, em, fonts } = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={{ fontFamily: fonts.fUiSemiBold, fontSize: 1.4 * em, color: colors.fg }}
    >
      {children}
    </Text>
  );
};

/** The dimmed screen behind the phone sheet; a tap on it closes the sheet. */
const Backdrop = (props: BottomSheetBackdropProps) => (
  <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
);

/**
 * The phone's bottom sheet: it rises over everything (the tab bar too), sizes to its content up
 * to most of the screen, and a swipe down, a tap beside it or Back closes it with its own motion.
 */
const PhoneSheet = ({ label, onClose, children }: SheetProps) => {
  const { colors, em, radii } = useTheme();
  const insets = useSafeAreaInsets();
  const ref = useRef<BottomSheetModal>(null);
  useEffect(() => {
    ref.current?.present();
  }, []);
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      ref.current?.dismiss();
      return true;
    });
    return () => subscription.remove();
  }, []);
  // The modal also reports a dismiss when it unmounts. A sheet that unmounts because its owner
  // swapped it for another (Watch → Resume or From start) must not close that owner as well.
  const unmounted = useRef(false);
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);
  const dismissed = useCallback(() => {
    if (!unmounted.current) onClose();
  }, [onClose]);
  return (
    <BottomSheetModal
      ref={ref}
      onDismiss={dismissed}
      enableDynamicSizing
      topInset={insets.top + 2 * em}
      backdropComponent={Backdrop}
      accessibilityLabel={label}
      backgroundStyle={{
        backgroundColor: colors.surface,
        borderTopLeftRadius: radii.rL,
        borderTopRightRadius: radii.rL,
      }}
      handleIndicatorStyle={{ backgroundColor: colors.line, width: 2.5 * em }}
    >
      <BottomSheetScrollView
        contentContainerStyle={{
          paddingHorizontal: 1.25 * em,
          paddingTop: 0.25 * em,
          paddingBottom: insets.bottom + 1.25 * em,
          gap: 0.6 * em,
        }}
      >
        {children}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
};

/**
 * A sheet over the screen: on TV a side sheet at the right edge that keeps focus inside, on a
 * phone a bottom sheet (above). Back closes it on both. The watch choice and the record sheet
 * look the same; this is their frame for the sheets built since.
 */
export const Sheet = ({ label, onClose, children }: SheetProps) => {
  const { isTV } = useTheme();
  return isTV ? (
    <TvSheet label={label} onClose={onClose}>
      {children}
    </TvSheet>
  ) : (
    <PhoneSheet label={label} onClose={onClose}>
      {children}
    </PhoneSheet>
  );
};

/** The TV's side sheet at the right edge, focus kept inside. */
const TvSheet = ({ label, onClose, children }: SheetProps) => {
  const { colors, em, radii } = useTheme();
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose]);
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 20 }]}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]} />
      <TVFocusGuideView
        autoFocus
        trapFocusUp
        trapFocusDown
        trapFocusLeft
        trapFocusRight
        accessibilityLabel={label}
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: 36 * em,
          backgroundColor: colors.surface,
          borderTopLeftRadius: radii.rL,
          borderBottomLeftRadius: radii.rL,
        }}
      >
        <ScrollView contentContainerStyle={{ padding: 2.7 * em, gap: 0.8 * em }}>
          {children}
        </ScrollView>
      </TVFocusGuideView>
    </View>
  );
};
