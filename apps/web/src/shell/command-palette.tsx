import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type KeyboardEvent, type RefObject, useId, useRef, useState } from "react";
import { epochMs, searchesGuide } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { useQueries } from "~/api/hooks.ts";
import { Dialog } from "~/ui/dialog.tsx";
import { Icon } from "~/ui/icon.tsx";
import {
  FolderIcon,
  GuideIcon,
  LiveIcon,
  RecordingsIcon,
  RulesIcon,
  SearchIcon,
} from "~/ui/icons.ts";
import { useOverlay, useOverlayBinding } from "~/ui/overlay/use-overlay.tsx";
import { rovingIndex } from "~/ui/roving.ts";
import { useDebouncedValue } from "~/ui/use-debounced-value.ts";
import { useNow } from "~/ui/use-now.ts";
import { navItems } from "./nav.ts";
import { filterOptions, groupOrder, type PaletteOption } from "./palette-options.ts";

const groupLabel = (group: PaletteOption["group"]): string => {
  switch (group) {
    case "actions":
      return m.palette_group_actions();
    case "channels":
      return m.channels_heading();
    case "guide":
      return m.palette_group_guide();
    case "recordings":
      return m.nav_recordings();
    case "collections":
      return m.library_collections();
    case "series":
      return m.series_title();
  }
};

/**
 * The ⌘K palette (SPEC §4, §7.2): a dialog with a combobox (`aria-activedescendant`), options
 * grouped into actions, channels, in the guide, recordings, collections and series recordings;
 * ↑/↓ move, Enter opens, Esc closes and focus returns. "In the guide" is the server's guide
 * search, asked once typing pauses and from two letters on; a programme opens its sheet, or the
 * watch choice when it is on air and being recorded. Results only hold what this profile may
 * see, because the server only returns that. `?dlg=cmdk` in the URL.
 */
export function CommandPalette() {
  const binding = useOverlayBinding("dlg", "cmdk");
  const inputRef = useRef<HTMLInputElement | null>(null);
  return binding.open || binding.overlay ? (
    <Dialog
      open={binding.open}
      onOpenChange={binding.onOpenChange}
      label={m.palette_label()}
      initialFocus={inputRef}
    >
      <PaletteBody inputRef={inputRef} />
    </Dialog>
  ) : null;
}

function PaletteBody({ inputRef }: { inputRef: RefObject<HTMLInputElement | null> }) {
  const queries = useQueries();
  const overlay = useOverlay();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const channels = useQuery(queries.channels());
  const recordings = useQuery(queries.recordings());
  const rules = useQuery(queries.rules());
  const collections = useQuery(queries.collections());
  const searched = useDebouncedValue(query.trim(), 200);
  const guide = useQuery({
    ...queries.guideSearch(searched),
    enabled: searchesGuide(searched),
    // The previous answer stays while the next one loads, so the list doesn't jump.
    placeholderData: keepPreviousData,
  });
  const channelName = (id: string) => channels.data?.find((channel) => channel.id === id)?.name;
  const now = useNow(30_000);

  const options: PaletteOption[] = [
    ...navItems.map((item): PaletteOption => ({
      id: `go-${item.key}`,
      group: "actions",
      title: m.palette_go_to({ place: item.label() }),
      icon: item.icon,
      run: () => overlay.leaveTo({ to: item.to }),
    })),
    ...(channels.data ?? [])
      .filter((channel) => !channel.hidden)
      .map((channel): PaletteOption => ({
        id: `channel-${channel.id}`,
        group: "channels",
        title: channel.name,
        ...(channel.number === undefined ? {} : { meta: String(channel.number) }),
        icon: LiveIcon,
        run: () => overlay.leaveTo({ to: "/watch/live/$channel", params: { channel: channel.id } }),
      })),
    ...(searchesGuide(query) && searchesGuide(searched) ? (guide.data ?? []) : []).map(
      (programme): PaletteOption => {
        const live = epochMs(programme.start) <= now && epochMs(programme.end) > now;
        const recording = live
          ? recordings.data?.find(
              (entry) => entry.programmeId === programme.id && entry.state === "recording",
            )
          : undefined;
        const channel = channelName(programme.channelId) ?? "";
        return {
          id: `programme-${programme.id}`,
          group: "guide",
          title: programme.title,
          meta: live
            ? m.palette_guide_live({ channel })
            : m.palette_guide_meta({ channel, start: new Date(epochMs(programme.start)) }),
          icon: GuideIcon,
          matched: true,
          run: () =>
            recording === undefined
              ? overlay.open({ kind: "sheet", name: "prog", arg: programme.id })
              : overlay.open({ kind: "choice", name: recording.id }),
        };
      },
    ),
    ...(recordings.data ?? []).map((entry): PaletteOption => ({
      id: `recording-${entry.id}`,
      group: "recordings",
      title: entry.title,
      ...(entry.subtitle === undefined ? {} : { meta: entry.subtitle }),
      icon: RecordingsIcon,
      run: () => overlay.open({ kind: "choice", name: entry.id }),
    })),
    ...(collections.data ?? []).map((collection): PaletteOption => ({
      id: `collection-${collection.id}`,
      group: "collections",
      title: collection.name,
      icon: FolderIcon,
      run: () =>
        overlay.leaveTo({
          to: "/recordings/c/$group/{-$season}",
          params: { group: collection.id },
        }),
    })),
    ...(rules.data ?? []).map((rule): PaletteOption => ({
      id: `series-${rule.id}`,
      group: "series",
      title: rule.name,
      icon: RulesIcon,
      run: () => overlay.leaveTo({ to: "/series/$id", params: { id: rule.id } }),
    })),
  ];
  const results = filterOptions(options, query);
  const current = results[Math.min(active, results.length - 1)];

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const index =
        rovingIndex(Math.min(active, results.length - 1), results.length, event.key) ?? 0;
      setActive(index);
      // The keys move the highlight past the list's fold: the option scrolls along with it.
      const option = results[index];
      if (option !== undefined) {
        document.getElementById(`${listId}-${option.id}`)?.scrollIntoView({ block: "nearest" });
      }
    } else if (event.key === "Enter" && current) {
      event.preventDefault();
      current.run();
    }
  };

  return (
    <div>
      <div className="cmdk-query">
        <Icon icon={SearchIcon} />
        <input
          ref={inputRef}
          className="cmdk-input"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={current ? `${listId}-${current.id}` : undefined}
          aria-label={m.palette_label()}
          placeholder={m.shell_search_placeholder()}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div id={listId} role="listbox" aria-label={m.palette_results()} className="cmdk-results">
        {results.length === 0 ? (
          <p className="cmdk-none wrap-anywhere">{m.palette_none({ query })}</p>
        ) : null}
        {groupOrder.map((group) => {
          const inGroup = results.filter((option) => option.group === group);
          if (inGroup.length === 0) return null;
          return (
            <div key={group} role="group" aria-label={groupLabel(group)}>
              <div className="cmdk-group" aria-hidden="true">
                {groupLabel(group)}
              </div>
              {inGroup.map((option) => (
                <div
                  key={option.id}
                  id={`${listId}-${option.id}`}
                  role="option"
                  aria-selected={option === current}
                  className="cmdk-option"
                  onPointerMove={() => setActive(results.indexOf(option))}
                  onClick={option.run}
                >
                  <span className="cmdk-option-icon">
                    <Icon icon={option.icon} size={16} />
                  </span>
                  <span className="cmdk-option-text">
                    <b className="cmdk-option-title">{option.title}</b>
                    {option.meta === undefined ? null : (
                      <span className="cmdk-option-meta block truncate">{option.meta}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
