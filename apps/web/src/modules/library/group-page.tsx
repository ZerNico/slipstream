import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { formatClock, formatDuration } from "~/i18n/formats.ts";
import { dayPill, m, pathLabels, whenLabel } from "@slipstream/i18n";
import { Artwork } from "~/ui/artwork/artwork.tsx";
import { Badge, Segmented } from "~/ui/controls.tsx";
import { Icon } from "~/ui/icon.tsx";
import { EditIcon, FolderIcon } from "~/ui/icons.ts";
import { useOverlay } from "~/ui/overlay/use-overlay.tsx";
import { Wrap } from "~/ui/page.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { LoadingScope, Sk } from "~/ui/skeleton.tsx";
import { EmptyState } from "~/ui/states.tsx";
import { useNow } from "~/ui/use-now.ts";
import { entrySubject } from "./art.ts";
import { Crumbs } from "~/ui/crumbs.tsx";
import { type GroupSection, groupPage } from "./groups.ts";
import { itemName, recordedSpan, type Entry } from "./library.ts";
import { tileGrid } from "./grids.ts";
import { type LibraryData, useLibraryData } from "./queries.ts";
import { RecordingCard } from "./recording-card.tsx";
import { keepWords } from "./words.ts";
import { channelMark, epochMs } from "@slipstream/domain";

/** Sessions of an event (SPEC §2.3): 2 columns, 3 from 768, 5 from 1100. */
const sessionGrid = "grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5";

/** A session's line under its title: day, start and recorded length. */
const sessionSub = (entry: Entry, now: number, timeZone: string | undefined): string => {
  const span = recordedSpan(entry);
  return m.library_session_sub({
    day: dayPill(epochMs(entry.start), now, timeZone),
    clock: formatClock(epochMs(entry.start)),
    length: formatDuration(span.end - span.start),
  });
};

/** A scheduled session as a ghost card: opens its programme sheet. */
function ScheduledCard({ entry, data, now }: { entry: Entry; data: LibraryData; now: number }) {
  const overlay = useOverlay();
  const channel = data.channel(entry.channelId);
  const when =
    data.timeZone === undefined ? "" : whenLabel(epochMs(entry.start), now, data.timeZone);
  return (
    <button
      type="button"
      className="card text-left"
      onClick={() =>
        entry.programmeId === undefined
          ? undefined
          : overlay.open({ kind: "sheet", name: "prog", arg: entry.programmeId })
      }
      aria-label={`${itemName(entry, pathLabels())}, ${m.library_scheduled_card({ when })}`}
    >
      <span className="card-media rounded-md outline-[1.5px] outline-brand-edge/60 outline-solid">
        <Artwork subject={entrySubject(entry, channel)} className="opacity-70" />
      </span>
      <span className="card-meta">
        <span className="card-title">
          <Sk>{itemName(entry, pathLabels())}</Sk>
        </span>
        <span className="card-sub">
          <Sk>
            <span className="font-semibold text-brand-fg">{m.status_scheduled()}</span>
            {` · ${when}`}
          </Sk>
        </span>
      </span>
    </button>
  );
}

/** One event or season: its title, badges, the days it spans, and its sessions. */
function SectionBlock({
  section,
  data,
  now,
}: {
  section: GroupSection;
  data: LibraryData;
  now: number;
}) {
  const all = [...section.entries, ...section.scheduled];
  const first = all[0];
  const last = all.at(-1);
  return (
    <section className="mt-9">
      <div className="mb-3.5 flex min-w-0 flex-wrap items-baseline gap-3">
        <h2 className="min-w-0 type-h2 text-[22px] break-words">
          <Sk>{section.title}</Sk>
        </h2>
        {section.recording ? <Badge tone="rec">{m.recordings_recording_now()}</Badge> : null}
        {first && last ? (
          <span className="text-[13px] text-fg-3">
            {dayPill(epochMs(first.start), now, data.timeZone)}
            {epochMs(first.start) === epochMs(last.start)
              ? null
              : ` – ${dayPill(epochMs(last.start), now, data.timeZone)}`}
          </span>
        ) : null}
      </div>
      <div className={sessionGrid}>
        {section.entries.map((entry) => (
          <RecordingCard
            key={entry.id}
            entry={entry}
            data={data}
            now={now}
            title={itemName(entry, pathLabels())}
            sub={sessionSub(entry, now, data.timeZone)}
          />
        ))}
        {section.scheduled.map((entry) => (
          <ScheduledCard key={entry.id} entry={entry} data={data} now={now} />
        ))}
      </div>
    </section>
  );
}

/**
 * A collection or automatic group page (SPEC §7.5, §8.4): header art, why things are here, the
 * layout and retention, Edit collection or Make it a collection; seasons and events when the
 * layout has them, with scheduled sessions as ghost cards.
 */
export function GroupPage({ groupKey, season }: { groupKey: string; season: string | undefined }) {
  const data = useLibraryData();
  const navigate = useNavigate();
  const now = useNow(60_000);
  const { recordings, collections } = data;
  // While loading, the page is drawn from the last answer when this browser kept one.
  const model = useMemo(
    () => groupPage(groupKey, recordings, collections, pathLabels(), season),
    [groupKey, recordings, collections, season],
  );
  if (!data.loading && model === undefined) {
    return (
      <Wrap>
        <Crumbs
          crumbs={[
            { label: m.nav_recordings(), link: { to: "/recordings" } },
            { label: m.library_kind_collection() },
          ]}
        />
        <div className="pt-6">
          <EmptyState
            title={m.library_group_missing()}
            action={
              <Button nativeButton={false} render={<Link to="/recordings" />}>
                {m.library_back_to_recordings()}
              </Button>
            }
          />
        </div>
      </Wrap>
    );
  }
  const group = model?.group;
  const name = group?.name ?? m.library_kind_collection();
  const collection = group?.collection;
  const first = group?.entries[0];
  const channel = first ? data.channel(first.channelId) : undefined;
  const stats = m.library_group_stats({
    count: group?.entries.length ?? 0,
    fresh: group?.newCount ?? 0,
  });
  return (
    <Wrap>
      <Crumbs
        crumbs={[
          { label: m.nav_recordings(), link: { to: "/recordings" } },
          ...(model?.season && model.seasons.length > 1
            ? [
                {
                  label: name,
                  link: {
                    to: "/recordings/c/$group/{-$season}" as const,
                    params: { group: groupKey },
                  },
                },
                { label: model.season },
              ]
            : [{ label: name }]),
        ]}
      />
      <LoadingScope loading={data.loading}>
        <div className="grid items-start gap-5 pt-4 pb-7 md:grid-cols-[320px_minmax(0,1fr)] md:gap-8">
          <Artwork
            noMark
            subject={{
              title: name,
              categories: first?.categories ?? [],
              ...(channel ? { channel: { mark: channelMark(channel.name) } } : {}),
            }}
            title={{ kicker: "", main: name }}
          />
          <div className="grid min-w-0 gap-2.5">
            <h1 className="type-display text-[clamp(34px,4.4vw,56px)] break-words">
              <Sk chars={10}>{group?.name}</Sk>
            </h1>
            <p className="text-fg-2">
              <Sk>
                {stats}
                {collection ? ` · ${keepWords(collection.retention)}` : ""}
              </Sk>
            </p>
            {data.isAdmin ? (
              <div className="flex flex-wrap items-center gap-2.5">
                {collection ? (
                  <Button
                    icon={<Icon icon={EditIcon} size={16} />}
                    nativeButton={false}
                    render={
                      <Link to="/recordings/collections/$id" params={{ id: collection.id }} />
                    }
                  >
                    {m.library_edit_collection()}
                  </Button>
                ) : (
                  <Button
                    icon={<Icon icon={FolderIcon} size={16} />}
                    nativeButton={false}
                    render={<Link to="/recordings/collections/new" search={{ from: groupKey }} />}
                  >
                    {m.library_make_collection()}
                  </Button>
                )}
              </div>
            ) : null}
          </div>
        </div>
        {model && model.seasons.length > 1 ? (
          // Many seasons scroll sideways on a phone instead of widening the page.
          <div className="scroller -m-0.5 p-0.5">
            <Segmented
              label={m.library_season_label()}
              value={model.season ?? ""}
              onChange={(next) =>
                void navigate({
                  to: "/recordings/c/$group/{-$season}",
                  params: { group: groupKey, season: next },
                  replace: true,
                })
              }
              segments={model.seasons.map((value) => ({ value, label: value }))}
            />
          </div>
        ) : null}
        {model && model.sections.length > 0
          ? model.sections.map((section) => (
              <SectionBlock key={section.key} section={section} data={data} now={now} />
            ))
          : null}
        {model && model.sections.length === 0 && model.flat.length > 0 ? (
          <div className={tileGrid}>
            {model.flat.map((entry) => (
              <RecordingCard
                key={entry.id}
                entry={entry}
                data={data}
                now={now}
                title={itemName(entry, pathLabels())}
                sub={sessionSub(entry, now, data.timeZone)}
              />
            ))}
          </div>
        ) : null}
        {model && model.season !== undefined && model.sections.length === 0 ? (
          <div className="mt-6">
            <EmptyState title={m.library_season_empty({ season: model.season })} />
          </div>
        ) : null}
        {model === undefined ? (
          <div className={`${tileGrid} mt-2`}>
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="card">
                <span className="sk-art aspect-video rounded-md" />
                <span className="card-meta">
                  <Sk chars={14} />
                  <Sk chars={20} />
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </LoadingScope>
    </Wrap>
  );
}
