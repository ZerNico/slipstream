import type { ReactNode } from "react";
import { useServerEvents } from "~/api/hooks.ts";
import { m } from "@slipstream/i18n";
import { media, useMediaQuery } from "~/ui/use-media-query.ts";
import { CommandPalette } from "./command-palette.tsx";
import { MiniPlayerHost } from "./mini-player.tsx";
import { Rail, TabBar, TopBar } from "./navigation.tsx";
import { OfflineStrip } from "./offline-strip.tsx";
import { OverlayHost } from "./overlay-host.tsx";
import { useShellMeta } from "./route-meta.ts";
import { ShortcutsDialog } from "./shortcuts-dialog.tsx";
import { useGlobalShortcuts } from "./shortcuts.ts";
import { useShellData } from "./use-shell-data.ts";

/**
 * The app shell (SPEC §2.2): skip link, rail, top bar, the offline strip, `main`, the mini player
 * slot, the tab bar, and the global overlays. Routes say what they need through `staticData`
 * (`full` for the player, `under` for Home's hero, `noMini` for editors and the short guide). Toasts and the live
 * region are mounted once at the root, so the player and sign-in have them too.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const meta = useShellMeta();
  const short = useMediaQuery(media.shortLandscape);
  const events = useServerEvents();
  const shell = useShellData();
  const problems = { recordings: shell.problems, lineup: shell.lineupProblems };
  useGlobalShortcuts();

  if (meta.full) {
    return (
      <>
        <main id="main" tabIndex={-1} className="shell-main" data-full="">
          {children}
        </main>
        <OverlayHost />
        <CommandPalette />
      </>
    );
  }

  return (
    <MiniPlayerHost enabled={meta.noMini === "short" ? !short : meta.noMini !== true}>
      <a className="shell-skip" href="#main">
        {meta.skipLabel ? meta.skipLabel() : m.shell_skip_to_content()}
      </a>
      <Rail problems={problems} />
      <TopBar problems={problems} under={meta.under === true} />
      <OfflineStrip events={events} />
      <main id="main" tabIndex={-1} className="shell-main" data-under={meta.under ? "" : undefined}>
        {children}
      </main>
      <TabBar problems={problems} />
      <OverlayHost />
      <CommandPalette />
      <ShortcutsDialog />
    </MiniPlayerHost>
  );
}
