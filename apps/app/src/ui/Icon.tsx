import Svg, { Circle, Path, Rect } from "react-native-svg";

/**
 * Icons from the design doc's symbol set (24 x 24, 1.8 stroke, round caps). Drawn with
 * react-native-svg so they stay sharp at ten feet and take the text colour.
 */
export type IconName =
  | "home"
  | "live"
  | "guide"
  | "rec"
  | "settings"
  | "play"
  | "pause"
  | "start"
  | "back"
  | "fwd"
  | "speed"
  | "audio"
  | "bell"
  | "series"
  | "recone"
  | "warn"
  | "clock"
  | "plus"
  | "lock"
  | "more"
  | "check"
  | "delete"
  | "chevronLeft"
  | "gear"
  | "user"
  | "server"
  | "tv"
  | "signOut"
  | "search"
  | "globe"
  | "pip";

/** Props for {@link Icon}: the glyph, its size in dp and its colour. */
export interface IconProps {
  readonly name: IconName;
  readonly size: number;
  readonly color: string;
}

/** One icon. */
export const Icon = ({ name, size, color }: IconProps) => {
  const stroke = {
    stroke: color,
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    fill: "none",
  } as const;
  const filled = { fill: color, stroke: "none" } as const;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {glyph(name, stroke, filled)}
    </Svg>
  );
};

type Stroke = {
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly strokeLinecap: "round";
  readonly strokeLinejoin: "round";
  readonly fill: "none";
};
type Filled = { readonly fill: string; readonly stroke: "none" };

const glyph = (name: IconName, stroke: Stroke, filled: Filled) => {
  switch (name) {
    case "home":
      return <Path d="M4 10.5 12 4l8 6.5V20h-5v-5.5H9V20H4z" {...stroke} />;
    case "live":
      return (
        <>
          <Circle cx={12} cy={12} r={2.2} {...stroke} />
          <Path
            d="M8.3 8.3a5.2 5.2 0 0 0 0 7.4M15.7 8.3a5.2 5.2 0 0 1 0 7.4M5.4 5.4a9.3 9.3 0 0 0 0 13.2M18.6 5.4a9.3 9.3 0 0 1 0 13.2"
            {...stroke}
          />
        </>
      );
    case "guide":
      return (
        <>
          <Rect x={3} y={4.5} width={18} height={15} rx={2.5} {...stroke} />
          <Path d="M3 9.5h18M3 14.5h18M9 9.5v10M15 14.5v5" {...stroke} />
        </>
      );
    case "rec":
      return (
        <>
          <Circle cx={12} cy={12} r={8.5} {...stroke} />
          <Circle cx={12} cy={12} r={3.2} {...filled} />
        </>
      );
    case "recone":
      return <Circle cx={12} cy={12} r={5} {...filled} />;
    case "series":
      return (
        <>
          <Circle cx={9} cy={12} r={4.2} {...filled} />
          <Path d="M15 7.6a4.4 4.4 0 0 1 0 8.8M18.5 6a6.6 6.6 0 0 1 0 12" {...stroke} />
        </>
      );
    case "settings":
      return (
        <>
          <Path d="M4 7h9M17 7h3M4 17h3M11 17h9" {...stroke} />
          <Circle cx={15} cy={7} r={2} {...stroke} />
          <Circle cx={9} cy={17} r={2} {...stroke} />
        </>
      );
    case "play":
      return <Path d="M8 5.5v13l10.5-6.5z" {...filled} />;
    case "pause":
      return <Path d="M8.5 6v12M15.5 6v12" {...stroke} strokeWidth={3.2} />;
    case "start":
      return (
        <>
          <Path d="M6 5.5v13" {...stroke} />
          <Path d="M18.5 5.5 9.5 12l9 6.5z" {...stroke} fill={stroke.stroke} />
        </>
      );
    case "pip":
      return (
        <>
          <Rect x={3} y={5} width={18} height={14} rx={2.5} {...stroke} />
          <Rect x={12} y={11.5} width={6.5} height={5} rx={1} {...filled} />
        </>
      );
    case "back":
      return <Path d="M11 6.5 5 12l6 5.5M19 6.5 13 12l6 5.5" {...stroke} />;
    case "fwd":
      return <Path d="M13 6.5 19 12l-6 5.5M5 6.5 11 12l-6 5.5" {...stroke} />;
    case "speed":
      return <Path d="M4.5 16a7.5 7.5 0 1 1 15 0M12 16l3.5-4.5" {...stroke} />;
    case "audio":
      return (
        <>
          <Rect x={3.5} y={5.5} width={17} height={13} rx={2.5} {...stroke} />
          <Path d="M7 11h3M7 14.5h6M13 11h4M15.5 14.5H17" {...stroke} />
        </>
      );
    case "bell":
      return (
        <Path
          d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14zM10 20.5a2 2 0 0 0 4 0"
          {...stroke}
        />
      );
    case "warn":
      return <Path d="M12 4 2.8 19.5h18.4zM12 10v4.2M12 16.8v.2" {...stroke} />;
    case "clock":
      return (
        <>
          <Circle cx={12} cy={12} r={8.5} {...stroke} />
          <Path d="M12 7.5V12l3 2" {...stroke} />
        </>
      );
    case "plus":
      return <Path d="M12 5v14M5 12h14" {...stroke} />;
    case "more":
      return (
        <>
          <Circle cx={5.5} cy={12} r={1.8} {...filled} />
          <Circle cx={12} cy={12} r={1.8} {...filled} />
          <Circle cx={18.5} cy={12} r={1.8} {...filled} />
        </>
      );
    case "gear":
      return (
        <>
          <Circle cx={12} cy={12} r={3} {...stroke} />
          <Path
            d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.6 7.6 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4 1 2-3.4z"
            {...stroke}
          />
        </>
      );
    case "user":
      return (
        <>
          <Circle cx={12} cy={8} r={4} {...stroke} />
          <Path d="M4 21a8 8 0 0 1 16 0" {...stroke} />
        </>
      );
    case "server":
      return (
        <>
          <Rect x={3} y={4} width={18} height={7} rx={2} {...stroke} />
          <Rect x={3} y={13} width={18} height={7} rx={2} {...stroke} />
          <Path d="M7 7.5h.01M7 16.5h.01" {...stroke} />
        </>
      );
    case "tv":
      return (
        <>
          <Rect x={2.5} y={4} width={19} height={13} rx={2} {...stroke} />
          <Path d="M8 21h8" {...stroke} />
        </>
      );
    case "globe":
      return (
        <>
          <Circle cx={12} cy={12} r={9} {...stroke} />
          <Path
            d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"
            {...stroke}
          />
        </>
      );
    case "search":
      return (
        <>
          <Circle cx={11} cy={11} r={6.5} {...stroke} />
          <Path d="m20 20-4.2-4.2" {...stroke} />
        </>
      );
    case "signOut":
      return <Path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" {...stroke} />;
    case "chevronLeft":
      return <Path d="M14.5 5.5 8 12l6.5 6.5" {...stroke} />;
    case "check":
      return <Path d="M5 12.5 9.8 17 19 7" {...stroke} />;
    case "delete":
      return (
        <Path
          d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.9 12.2a1.5 1.5 0 0 0 1.5 1.3h6.2a1.5 1.5 0 0 0 1.5-1.3L17.5 7M10 11v6M14 11v6"
          {...stroke}
        />
      );
    case "lock":
      return (
        <>
          <Rect x={5} y={10.5} width={14} height={9.5} rx={2} {...stroke} />
          <Path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" {...stroke} />
        </>
      );
  }
};
