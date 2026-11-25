import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { User } from "@slipstream/domain";
import { useHouseholdTimeZone, useQueries } from "~/api/hooks.ts";
import { shapes } from "~/api/shape-cache.ts";
import { m } from "@slipstream/i18n";
import { upcomingWindow } from "~/modules/library/conflicts.ts";
import { Icon } from "~/ui/icon.tsx";
import { RefreshIcon } from "~/ui/icons.ts";
import { Wrap } from "~/ui/page.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { LoadingScope } from "~/ui/skeleton.tsx";
import { ErrorState } from "~/ui/states.tsx";
import { toast } from "~/ui/toast-manager.ts";
import { useNow } from "~/ui/use-now.ts";
import { attentionIssues } from "./attention.ts";
import { type AttentionCard, AttentionSection } from "./attention-section.tsx";
import { continueText, newText, onNowText, scheduledText } from "./card-text.ts";
import { dismissIssue, restoreIssue, useDismissedIssues } from "./dismissed.ts";
import { Hero } from "./hero.tsx";
import { HeroSwitcher } from "./hero-switcher.tsx";
import { heroText, skeletonHero } from "./hero-text.ts";
import { heroView } from "./hero-view.ts";
import {
  ContinueCard,
  HomeRow,
  NewCard,
  OnNowCard,
  PlaceholderRow,
  ScheduledCard,
} from "./home-rows.tsx";
import { issueView } from "./issue-text.ts";
import {
  continueRow,
  type HomeData,
  heroRecordingIds,
  initialTab,
  newRow,
  onNowRow,
  scheduledRow,
  selectHero,
} from "./model.ts";
import { type HomeShape, homeShape, readShape, type RowText } from "./shape.ts";
import "./home.css";

/** Home for the signed-in account of the app layout. */
export function HomePage() {
  const { me } = useRouteContext({ from: "/_app" });
  return <HomeScreen me={me} />;
}

/**
 * Home (SPEC §8.1): the hero with its five states, Needs attention, the rows and, for admins,
 * the Server strip. Loading is a state of the same tree (SPEC §6.2): the skeleton renders the
 * words this device saw last as transparent bars, so a reload lands in the same boxes.
 */
export function HomeScreen({ me }: { me: Pick<User, "id" | "displayName" | "role"> }) {
  const queries = useQueries();
  const admin = me.role === "admin";
  const now = useNow(30_000);
  const { from, to } = upcomingWindow(now);
  const [shape] = useState(readShape);
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const dismissed = useDismissedIssues();

  // The list this browser kept draws the parallel-recordings switcher under the skeleton, so
  // its slot is there from the first frame when more than one records.
  const recordings = useQuery({
    ...queries.recordings(),
    placeholderData: (previous) => previous ?? shapes.recordings.read(),
  });
  const rules = useQuery(queries.rules());
  const sources = useQuery(queries.sources());
  const channels = useQuery(queries.channels());
  const nowNext = useQuery(queries.nowNext());
  const progress = useQuery(queries.continueWatching());
  const profiles = useQuery(queries.profiles());
  const conflicts = useQuery(queries.conflicts(from, to));
  // "Today" and "Tomorrow" are household days, the server's; never the browser's. Until the
  // zone is known Home is its skeleton, and nothing that names a day is worked out.
  const timeZone = useHouseholdTimeZone();

  const core = [recordings, rules, sources, channels, nowNext, progress];
  const failed = core.some((query) => query.isError && query.data === undefined);
  const loading =
    !failed &&
    (core.some((query) => query.isPending) ||
      recordings.isPlaceholderData ||
      timeZone === undefined ||
      (admin && conflicts.isPending));

  const data: HomeData = {
    now,
    me: me.id,
    recordings: recordings.data ?? [],
    rules: rules.data ?? [],
    sourceCount: sources.data?.length ?? 0,
    channels: channels.data ?? [],
    nowNext: nowNext.data ?? [],
    progress: progress.data ?? [],
  };
  const hero = selectHero(data);
  const heroIds = loading ? shape.heroIds : heroRecordingIds(hero);

  const items = hero.kind === "recording" ? hero.items : [];
  const pickedIndex = items.findIndex((entry) => entry.id === picked);
  const selected = pickedIndex >= 0 ? pickedIndex : initialTab(items, me.id, data.rules);
  const sourceViews = sources.data ?? [];
  const view =
    loading || timeZone === undefined
      ? skeletonHero(shape.hero, shape.heroText)
      : heroView(hero, selected, { now, timeZone, channels: data.channels });

  const onboarding = hero.kind === "onboarding";
  const issues = onboarding
    ? []
    : attentionIssues({
        me: me.id,
        admin,
        now,
        recordings: data.recordings,
        conflicts: conflicts.data ?? [],
        sources: sourceViews,
        dismissed,
      });
  // Conflict titles name a day: none is worked out until the household's zone is known.
  const cards: readonly AttentionCard[] =
    timeZone === undefined
      ? []
      : issues.map((issue) => {
          const text = issueView(issue, now, timeZone);
          return {
            key: issue.id,
            text,
            onDismiss: () => {
              dismissIssue(issue.id);
              toast({
                title: m.home_issue_dismissed({ title: text.title }),
                undo: () => restoreIssue(issue.id),
              });
            },
          };
        });

  const ruleName = (id: string | undefined) => data.rules.find((rule) => rule.id === id)?.name;
  const rows: { readonly text: RowText; readonly cards: readonly ReactNode[] }[] = [];
  if (!onboarding) {
    const cont = continueRow(data, heroIds);
    if (cont.length > 0) {
      const texts = cont.map((entry) => continueText(entry, data.channels));
      rows.push({
        text: {
          key: "continue",
          title: m.player_continue_watching(),
          more: { label: m.nav_recordings(), to: "/recordings" },
          cards: texts,
        },
        cards: cont.map((entry, index) => (
          <ContinueCard
            key={entry.id}
            entry={entry}
            text={texts[index] ?? continueText(entry, data.channels)}
            channels={data.channels}
          />
        )),
      });
    }
  }
  const onNow = onNowRow(data);
  if (onNow.length > 0) {
    const texts = onNow.map(onNowText);
    rows.push({
      text: {
        key: "now",
        title: m.guide_on_now(),
        more: { label: m.nav_guide(), to: "/guide" },
        cards: texts,
      },
      cards: onNow.map((item, index) => (
        <OnNowCard
          key={item.channel.id}
          item={item}
          text={texts[index] ?? onNowText(item)}
          now={now}
        />
      )),
    });
  }
  if (!onboarding) {
    // Time pills name a day: until the zone is known Home shows its skeleton rows instead.
    const scheduled = timeZone === undefined ? [] : scheduledRow(data, conflicts.data ?? []);
    if (timeZone !== undefined && scheduled.length > 0) {
      const texts = scheduled.map((item) =>
        scheduledText(item, data.channels, ruleName(item.entry.ruleId)),
      );
      rows.push({
        text: {
          key: "scheduled",
          title: m.home_row_scheduled(),
          more: { label: m.guide_all_scheduled(), to: "/recordings/scheduled" },
          cards: texts,
        },
        cards: scheduled.map((item, index) => (
          <ScheduledCard
            key={item.entry.id}
            item={item}
            text={texts[index] ?? scheduledText(item, data.channels, undefined)}
            channels={data.channels}
            now={now}
            timeZone={timeZone}
          />
        )),
      });
    }
    const fresh = newRow(data, heroIds);
    if (fresh.length > 0) {
      const texts = fresh.map((entry) => newText(entry, data.channels));
      rows.push({
        text: {
          key: "new",
          title: m.home_row_new(),
          more: { label: m.nav_recordings(), to: "/recordings" },
          cards: texts,
        },
        cards: fresh.map((entry, index) => (
          <NewCard
            key={entry.id}
            entry={entry}
            text={texts[index] ?? newText(entry, data.channels)}
            channels={data.channels}
          />
        )),
      });
    }
  }

  const loadedShape: HomeShape = {
    hero: hero.kind,
    ...(loading ? {} : { heroText: heroText(view) }),
    heroIds,
    issues: cards.map((card) => card.text),
    rows: rows.map((row) => row.text),
  };
  // Kept whenever what it says changes (its JSON), not on every render.
  const serialised = JSON.stringify(loadedShape);
  const kept = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (loading || failed || kept.current === serialised) return;
    kept.current = serialised;
    homeShape.write(loadedShape);
  });

  if (failed) {
    return (
      <div data-home-error="">
        <Wrap>
          <ErrorState
            title={m.home_error_title()}
            actions={
              <Button
                variant="primary"
                icon={<Icon icon={RefreshIcon} />}
                onClick={() => {
                  for (const query of core) {
                    if (query.isError) void query.refetch();
                  }
                }}
              >
                {m.action_try_again()}
              </Button>
            }
          />
        </Wrap>
      </div>
    );
  }

  return (
    <LoadingScope loading={loading} data-home-page="">
      <Hero
        view={view}
        wall={onNow.map((item) => item.programme.title)}
        switcher={
          items.length > 1 ? (
            <HeroSwitcher
              items={items}
              selected={selected}
              onSelect={(index) => setPicked(items[index]?.id)}
              channels={data.channels}
              profiles={profiles.data ?? []}
              now={now}
            />
          ) : undefined
        }
      />
      <Wrap data-home-body="">
        {loading ? (
          <>
            <AttentionSection
              cards={shape.issues.map((text, index) => ({
                key: String(index),
                text,
                onDismiss: () => {},
              }))}
            />
            {shape.rows.map((row) => (
              <PlaceholderRow key={row.key} row={row} />
            ))}
          </>
        ) : (
          <>
            <AttentionSection cards={cards} />
            {rows.map((row) => (
              <HomeRow key={row.text.key} row={row.text}>
                {row.cards}
              </HomeRow>
            ))}
          </>
        )}
      </Wrap>
    </LoadingScope>
  );
}
