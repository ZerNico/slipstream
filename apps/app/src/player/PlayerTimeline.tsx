import { m, type PlayerReadout } from "@slipstream/i18n";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { useTheme } from "../theme/theme.ts";
import { Chip } from "../ui/Chip.tsx";
import { type BarLabel, type BarLabels, barTypeSizes, type PlayerBar } from "./bar.ts";

/*
 * The player's read-out and the rows around its timeline, the web's layout on phone and TV. The
 * bar itself is the caller's, so TV focus and the phone's scrub keep wrapping it. Every row
 * keeps its height before its words arrive, so nothing moves when the guide answers.
 */

/** Type sizes in dp: the bar's, and the web's 36 px read-out and 13 px quiet line (TV at 1080p). */
const sizes = (em: number, isTV: boolean) => ({
  ...barTypeSizes(em, isTV),
  readout: (isTV ? 2.33 : 1.9) * em,
  sub: (isTV ? 0.95 : 0.8) * em,
});

/** The read-out: the delta and its word, the LIVE pill at live, and the quiet line under them. */
export const ReadoutView = ({ readout }: { readonly readout: PlayerReadout | undefined }) => {
  const { colors, em, fonts, isTV } = useTheme();
  const size = sizes(em, isTV);
  const deltaColor =
    readout?.kind === "left"
      ? colors.fg
      : readout?.kind === "live"
        ? colors.liveText
        : colors.brandText;
  return (
    <View>
      {/* One line, the delta's height, whether it shows a delta, the pill or nothing yet. */}
      <View
        style={{
          height: size.readout,
          flexDirection: "row",
          alignItems: "center",
          gap: 0.6 * em,
        }}
      >
        {readout?.kind === "live" ? (
          <Chip label={m.status_live()} tone="live" size={isTV ? 1 : 0.85} />
        ) : (
          <Text
            style={{
              fontFamily: fonts.fDisplayBold,
              fontSize: size.readout,
              lineHeight: size.readout,
              letterSpacing: -0.03 * size.readout,
              color: deltaColor,
              fontVariant: ["tabular-nums"],
            }}
          >
            {readout?.delta ?? ""}
          </Text>
        )}
        <Text
          numberOfLines={1}
          style={{
            flexShrink: 1,
            fontFamily: fonts.fUiSemiBold,
            fontSize: size.label,
            color: colors.fg2,
          }}
        >
          {readout?.label ?? ""}
        </Text>
      </View>
      <Text
        numberOfLines={1}
        style={{
          marginTop: 0.3 * em,
          height: 1.4 * size.sub,
          lineHeight: 1.4 * size.sub,
          fontFamily: fonts.fUi,
          fontSize: size.sub,
          color: colors.fg3,
          fontVariant: ["tabular-nums"],
        }}
      >
        {readout === undefined || readout.sub.length === 0
          ? " "
          : readout.sub.map((part, index) => (
              <Text key={part.map((piece) => piece.text).join(" ")}>
                {index > 0 ? " · " : ""}
                {part.map((piece, at) => (
                  <Text
                    key={piece.text}
                    style={
                      piece.strong === true
                        ? { fontFamily: fonts.fUiSemiBold, color: colors.fg2 }
                        : piece.speed === true
                          ? { fontFamily: fonts.fUiSemiBold, color: colors.brandText }
                          : undefined
                    }
                  >
                    {at > 0 ? " " : ""}
                    {piece.text}
                  </Text>
                ))}
              </Text>
            ))}
      </Text>
    </View>
  );
};

/** A label hung from its spot on the bar: centred, or inwards near an edge. Hidden keeps its row. */
const Hung = ({
  label,
  width,
  size,
  color,
  children,
}: {
  readonly label: BarLabel;
  readonly width: number;
  readonly size: number;
  readonly color: string;
  readonly children?: ReactNode;
}) => {
  const { fonts } = useTheme();
  // A box wide enough for "LIVE 18:42" in this type, so its words never wrap.
  const box = 8 * size;
  const x = label.at * width;
  const position =
    label.align === "start"
      ? { left: x }
      : label.align === "end"
        ? { right: width - x }
        : { left: x - box / 2 };
  const justify =
    label.align === "start" ? "flex-start" : label.align === "end" ? "flex-end" : "center";
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        width: box,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: justify,
        gap: 0.4 * size,
        opacity: label.visible ? 1 : 0,
        ...position,
      }}
    >
      {children}
      <Text
        numberOfLines={1}
        style={{
          fontFamily: fonts.fUiSemiBold,
          fontSize: size,
          lineHeight: 1.35 * size,
          color,
          fontVariant: ["tabular-nums"],
        }}
      >
        {label.text}
      </Text>
    </View>
  );
};

/**
 * Above the bar: your time over the knob (and "LIVE 18:42" at the edge while behind), then the
 * programme bands, each with a divider where it starts, its name cut short with an ellipsis and
 * left out when the band is too narrow for it. The programme at the playhead is the bright one.
 */
export const AboveBar = ({
  bar,
  labels,
  width,
}: {
  readonly bar: PlayerBar | undefined;
  readonly labels: BarLabels | undefined;
  readonly width: number;
}) => {
  const { colors, em, fonts, isTV } = useTheme();
  const size = sizes(em, isTV);
  return (
    <View style={{ width }}>
      <View style={{ height: 1.35 * size.label }}>
        {labels?.live === undefined ? null : (
          <Hung label={labels.live} width={width} size={size.label} color={colors.liveText}>
            <View
              style={{
                width: 0.5 * size.label,
                height: 0.5 * size.label,
                borderRadius: 0.25 * size.label,
                backgroundColor: colors.liveText,
              }}
            />
          </Hung>
        )}
        {labels?.here === undefined ? null : (
          <Hung label={labels.here} width={width} size={size.label} color={colors.brandText} />
        )}
      </View>
      <View style={{ height: 1.4 * size.band, marginTop: 0.25 * em, marginBottom: 0.35 * em }}>
        {(bar?.layout.bands ?? []).map((band) => {
          const left = (band.left / 100) * width;
          const bandWidth = (band.width / 100) * width;
          return (
            <View
              key={`${band.left}-${band.title}`}
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left,
                width: bandWidth,
                borderLeftWidth: 1,
                borderLeftColor: band.current ? colors.fg2 : colors.fg3,
                paddingLeft: 0.45 * size.band,
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              {/* Too narrow for a word: only the divider shows. */}
              {bandWidth < 3.6 * size.band ? null : (
                <Text
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  style={{
                    fontFamily: band.current ? fonts.fUiSemiBold : fonts.fUiMedium,
                    fontSize: size.band,
                    color: band.current ? colors.fg : colors.fg3,
                  }}
                >
                  {band.title}
                </Text>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
};

/** Under the bar: where it starts and ends, "0:00" and the length, or the wall clock. */
export const BelowBar = ({
  labels,
  width,
}: {
  readonly labels: BarLabels | undefined;
  readonly width: number;
}) => {
  const { colors, em, isTV } = useTheme();
  const size = sizes(em, isTV);
  return (
    <View style={{ width, height: 1.35 * size.label, marginTop: 0.2 * em }}>
      {labels === undefined ? null : (
        <>
          <Hung label={labels.start} width={width} size={size.label} color={colors.fg3} />
          <Hung label={labels.end} width={width} size={size.label} color={colors.fg3} />
        </>
      )}
    </View>
  );
};
