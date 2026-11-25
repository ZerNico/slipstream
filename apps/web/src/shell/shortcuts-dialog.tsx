import { m } from "@slipstream/i18n";
import { Dialog } from "~/ui/dialog.tsx";
import { useOverlayBinding } from "~/ui/overlay/use-overlay.tsx";
import { isApplePlatform } from "~/ui/platform.ts";
import { Kbd } from "~/ui/primitives/kbd.tsx";
import { navItems } from "./nav.ts";

/** One documented shortcut: the keys and what they do. */
interface Shortcut {
  /** Key caps: symbols and letters as they are, named keys through the messages. */
  readonly keys: ReadonlyArray<string | (() => string)>;
  readonly does: () => string;
}

/** The shortcuts by place (SPEC §7.2). Key caps are symbols or letters, the same in every language. */
const sections: ReadonlyArray<{
  readonly title: () => string;
  readonly items: readonly Shortcut[];
}> = [
  {
    title: () => m.keys_section_everywhere(),
    items: [
      {
        keys: [() => m.key_command({ apple: isApplePlatform() }), "K"],
        does: () => m.nav_search(),
      },
      { keys: ["/"], does: () => m.nav_search() },
      { keys: ["?"], does: () => m.keys_this_list() },
      // G then the place's key, from the navigation that binds them.
      ...navItems.map((item): Shortcut => ({
        keys: ["G", item.key2.toUpperCase()],
        does: () => m.palette_go_to({ place: item.label() }),
      })),
      { keys: [() => m.key_escape()], does: () => m.keys_close_layer() },
    ],
  },
  {
    title: () => m.nav_guide(),
    items: [
      { keys: ["←", "→", "↑", "↓"], does: () => m.keys_guide_move() },
      { keys: [() => m.key_enter()], does: () => m.keys_guide_open() },
      { keys: ["N"], does: () => m.keys_guide_now() },
      { keys: ["P"], does: () => m.keys_guide_prime() },
    ],
  },
  {
    title: () => m.keys_section_player(),
    items: [
      { keys: [() => m.key_space()], does: () => m.keys_player_play() },
      { keys: ["←", "→"], does: () => m.keys_player_skip() },
      { keys: ["⇧", "←", "→"], does: () => m.keys_player_skip_long() },
      { keys: [() => m.key_home()], does: () => m.keys_player_start() },
      { keys: [() => m.key_end()], does: () => m.keys_player_live() },
      { keys: ["↑", "↓"], does: () => m.player_volume() },
      { keys: ["M"], does: () => m.player_mute_action() },
      { keys: ["<", ">"], does: () => m.keys_player_speed() },
      { keys: ["I"], does: () => m.keys_player_panel() },
      { keys: ["Z"], does: () => m.keys_player_fit() },
      { keys: ["F"], does: () => m.player_fullscreen() },
      { keys: ["R"], does: () => m.record_now_key() },
    ],
  },
];

/** Each cap with a stable id: the caps up to it ("G", "G+G"), so repeated keys stay distinct. */
const capsWithKeys = (keys: Shortcut["keys"]): Array<readonly [string, string]> => {
  const caps = keys.map((key) => (typeof key === "string" ? key : key()));
  return caps.map((cap, index) => [caps.slice(0, index + 1).join("+"), cap] as const);
};

/** The keyboard shortcuts dialog (`?dlg=keys`, or `?`). Offered only with a fine pointer. */
export function ShortcutsDialog() {
  const binding = useOverlayBinding("dlg", "keys");
  if (!binding.open && !binding.overlay) return null;
  return (
    <Dialog
      open={binding.open}
      onOpenChange={binding.onOpenChange}
      label={m.account_shortcuts()}
      showTitle
    >
      <div className="grid gap-5 p-5.5 sm:grid-cols-2">
        {sections.map((section) => (
          <section key={section.title()} className="grid content-start gap-1">
            <h3 className="type-eyebrow pb-1">{section.title()}</h3>
            {section.items.map((item) => (
              <div
                key={item.does() + item.keys.length}
                className="flex items-center justify-between gap-3 border-b border-line py-1.5 text-sm"
              >
                <span>{item.does()}</span>
                <span className="flex gap-1">
                  {capsWithKeys(item.keys).map(([id, cap]) => (
                    <Kbd key={id}>{cap}</Kbd>
                  ))}
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Dialog>
  );
}
