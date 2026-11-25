import { type ReactElement, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { extendStepMinutes } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { Icon } from "~/ui/icon.tsx";
import { AddIcon, CloseIcon, RecordIcon, SettingsIcon } from "~/ui/icons.ts";
import { MenuItem, MenuLabel, MenuSeparator, ResponsiveMenu } from "~/ui/menu.tsx";
import { IconButton } from "~/ui/primitives/button.tsx";
import { PhoneChip } from "./player-controls.tsx";
import type { RecordControl } from "./use-record-now.ts";

/*
 * The Record control's looks: a round button in the control row (a chip on phone portrait),
 * red with a menu (Extend, Stop) while it records; a long press opens the record options.
 */

/** Long press (or right click) opens the record options instead of recording. */
function useLongPress(onLong: (() => void) | undefined) {
  const timer = useRef<number | undefined>(undefined);
  const fired = useRef(false);
  const clear = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  };
  return {
    /** Whether the click that ends this press was the long press's. */
    consumed: () => {
      const was = fired.current;
      fired.current = false;
      return was;
    },
    handlers:
      onLong === undefined
        ? {}
        : {
            onPointerDown: (event: ReactPointerEvent) => {
              if (event.button !== 0) return;
              fired.current = false;
              clear();
              timer.current = window.setTimeout(() => {
                fired.current = true;
                onLong();
              }, 550);
            },
            onPointerUp: clear,
            onPointerLeave: clear,
            onPointerCancel: clear,
            onContextMenu: (event: { preventDefault: () => void }) => {
              event.preventDefault();
              clear();
              onLong();
            },
          },
  };
}

/** The recording menu: "Recording until 20:30", Extend, Stop, the full options. */
function RecordingMenu({
  control,
  trigger,
}: {
  control: Extract<RecordControl, { kind: "recording" }>;
  trigger: ReactElement;
}) {
  return (
    <ResponsiveMenu
      name="recording"
      label={m.player_badge_recording()}
      trigger={trigger}
      side="top"
      cine
      className="max-w-80"
    >
      <MenuLabel>{control.until}</MenuLabel>
      <MenuItem
        icon={<Icon icon={AddIcon} size={16} />}
        onSelect={control.onExtend}
        disabled={control.busy}
      >
        {m.player_extend({ minutes: extendStepMinutes })}
      </MenuItem>
      <MenuItem
        icon={<Icon icon={CloseIcon} size={16} />}
        onSelect={control.onStop}
        disabled={control.busy}
      >
        {m.guide_stop_recording()}
      </MenuItem>
      {control.onOptions === undefined ? null : (
        <>
          <MenuSeparator />
          <MenuItem icon={<Icon icon={SettingsIcon} size={16} />} onSelect={control.onOptions}>
            {m.record_now_options()}
          </MenuItem>
        </>
      )}
    </ResponsiveMenu>
  );
}

/**
 * The control row's Record button: a round button with the record dot, red while it records.
 * `undefined` keeps its place empty (a programme that has ended, no guide), so the row never
 * moves when the playhead crosses into another programme.
 */
export function RecordButton({ control }: { control: RecordControl | undefined }) {
  const longPress = useLongPress(control?.kind === "record" ? control.onOptions : undefined);
  if (control === undefined) {
    return <span aria-hidden="true" className="inline-block size-(--ctl-md) flex-none" />;
  }
  if (control.kind === "recording") {
    return (
      <RecordingMenu
        control={control}
        trigger={
          <IconButton label={m.player_badge_recording()} variant="live">
            <Icon icon={RecordIcon} />
          </IconButton>
        }
      />
    );
  }
  return (
    <IconButton
      label={m.record_now_action()}
      disabled={control.busy}
      {...longPress.handlers}
      onClick={() => {
        if (!longPress.consumed()) control.onRecord();
      }}
    >
      <Icon icon={RecordIcon} />
    </IconButton>
  );
}

/** Phone portrait: Record as one of the option chips under the transport. */
export function RecordChip({ control }: { control: RecordControl | undefined }) {
  const longPress = useLongPress(control?.kind === "record" ? control.onOptions : undefined);
  if (control === undefined) return null;
  if (control.kind === "recording") {
    return (
      <RecordingMenu
        control={control}
        trigger={
          <PhoneChip icon={RecordIcon} className="text-live-fg">
            {m.player_badge_recording()}
          </PhoneChip>
        }
      />
    );
  }
  return (
    <PhoneChip
      icon={RecordIcon}
      disabled={control.busy}
      {...longPress.handlers}
      onClick={() => {
        if (!longPress.consumed()) control.onRecord();
      }}
    >
      {m.record_now_action()}
    </PhoneChip>
  );
}
