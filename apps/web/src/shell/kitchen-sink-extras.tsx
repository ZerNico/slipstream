import { useState } from "react";
import { formatBytes, formatDay, formatSlot, formatTimeRange } from "~/i18n/formats.ts";
import { chooseLocale, useLocale } from "~/i18n/locale.ts";
import { languageName, locales, m } from "@slipstream/i18n";
import { ks } from "@slipstream/i18n/kitchen-sink";
import { announce } from "~/ui/announce-store.ts";
import { Segmented } from "~/ui/controls.tsx";
import { Icon } from "~/ui/icon.tsx";
import * as icons from "~/ui/icons.ts";
import { Section, TabLinks, Toolbar } from "~/ui/page.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { Switch } from "~/ui/primitives/switch.tsx";
import { Sk, SkArt } from "~/ui/skeleton.tsx";
import { placeholderList } from "~/ui/skeleton-state.ts";
import { dismissToast, toast } from "~/ui/toast-manager.ts";
import { useSuppressMiniPlayer } from "./mini-player-store.ts";
import { MINUTE } from "@slipstream/domain";

/** Every glyph by its meaning, so screens pick from the set instead of adding look-alikes. */
export function IconGallery() {
  return (
    <Section title={ks.icons()}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {Object.entries(icons).map(([name, glyph]) => (
          <div key={name} className="flex min-w-0 items-center gap-2 rounded-md p-2 text-fg-2">
            <Icon icon={glyph} />
            <code className="truncate text-caption">{name}</code>
          </div>
        ))}
      </div>
    </Section>
  );
}

/** Dates, sizes and the language switch, the way every screen formats them. */
export function FormatsAndLanguage({ now }: { now: number }) {
  const locale = useLocale();
  return (
    <Section title={ks.formats()}>
      <div className="grid gap-3">
        <Segmented
          label={m.language_label()}
          value={locale}
          onChange={chooseLocale}
          segments={locales.map((value) => ({ value, label: languageName(value) }))}
        />
        <dl className="grid max-w-md grid-cols-2 gap-x-4 gap-y-1 text-sm tabular-nums">
          <dt className="text-fg-2">{ks.format_day()}</dt>
          <dd>{formatDay(now)}</dd>
          <dt className="text-fg-2">{ks.format_slot()}</dt>
          <dd>{formatSlot(now, now + 90 * MINUTE)}</dd>
          <dt className="text-fg-2">{ks.format_range()}</dt>
          <dd>{formatTimeRange(now, now + 90 * MINUTE)}</dd>
          <dt className="text-fg-2">{ks.format_size()}</dt>
          <dd>{formatBytes(412e9)}</dd>
        </dl>
      </div>
    </Section>
  );
}

/** Route tabs, a list at its expected length while loading, the live region, toasts, mini player. */
export function MoreParts() {
  const [lastToast, setLastToast] = useState<string | null>(null);
  const [hideMini, setHideMini] = useState(false);
  useSuppressMiniPlayer(hideMini ? ["kitchen-sink"] : []);
  const rows = placeholderList<string | null>(undefined, 3, () => null);
  return (
    <Section title={ks.more()}>
      <div className="grid gap-4">
        <TabLinks
          label={ks.more()}
          tabs={[
            { label: ks.title(), to: "/dev/kitchen-sink" },
            {
              label: m.recordings_tab_problems(),
              to: "/recordings/problems",
              count: 4,
              tone: "warn",
            },
            { label: m.library_title_scheduled(), to: "/recordings/scheduled", count: 6 },
          ]}
        />
        <ul className="grid max-w-md gap-2">
          {rows.map((row, index) => (
            <li key={`row-${String(index)}`} className="flex items-center gap-3">
              <SkArt className="h-10 w-16 rounded-sm bg-raised" />
              <Sk chars={18}>{row}</Sk>
            </li>
          ))}
        </ul>
        <Toolbar aria-label={ks.more()}>
          <Button onClick={() => announce(ks.saved())}>{ks.announce()}</Button>
          <Button
            onClick={() =>
              setLastToast(toast({ title: ks.toast_title(), description: ks.toast_text() }))
            }
          >
            {ks.show_toast()}
          </Button>
          <Button
            disabled={lastToast === null}
            onClick={() => {
              if (lastToast !== null) dismissToast(lastToast);
              setLastToast(null);
            }}
          >
            {ks.close_toast()}
          </Button>
          <label className="flex items-center gap-3">
            <Switch checked={hideMini} onCheckedChange={setHideMini} />
            {ks.hide_mini()}
          </label>
        </Toolbar>
      </div>
    </Section>
  );
}
