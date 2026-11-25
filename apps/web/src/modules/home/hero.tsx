import { Link } from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";
import { formatClock } from "~/i18n/formats.ts";
import { m } from "@slipstream/i18n";
import { Mark } from "~/shell/logo.tsx";
import { Artwork } from "~/ui/artwork/artwork.tsx";
import type { ArtworkSubject } from "~/ui/artwork/generate.ts";
import { Badge } from "~/ui/controls.tsx";
import { Icon } from "~/ui/icon.tsx";
import { AddIcon, FromStartIcon, InfoIcon, LiveIcon, PlayIcon } from "~/ui/icons.ts";
import { useOverlay } from "~/ui/overlay/use-overlay.tsx";
import { Wrap } from "~/ui/page.tsx";
import { Button, IconButton } from "~/ui/primitives/button.tsx";
import { Sk } from "~/ui/skeleton.tsx";
import { Timeline } from "~/ui/timeline/timeline.tsx";
import { media, useMediaQuery } from "~/ui/use-media-query.ts";
import {
  type HeroAction,
  type HeroIcon,
  heroPanelId,
  type HeroTarget,
  type HeroView,
  type ReadLine,
  titleSteps,
} from "./hero-view.ts";

function HeroIconGlyph({ icon }: { icon: HeroIcon }) {
  switch (icon) {
    case "play":
      return <Icon icon={PlayIcon} />;
    case "fromStart":
      return <Icon icon={FromStartIcon} />;
    case "live":
      return <Icon icon={LiveIcon} className="text-live-fg" />;
    case "liveDot":
      return <span className="block size-2.5 shrink-0 rounded-full bg-live" aria-hidden="true" />;
    case "add":
      return <Icon icon={AddIcon} />;
    case "none":
      return null;
  }
}

/** A link element for a hero target, or `undefined` for targets that open an overlay. */
function targetLink(target: HeroTarget): ReactElement | undefined {
  switch (target.to) {
    case "recording":
      return <Link to="/watch/rec/$id" params={{ id: target.id }} search={{ at: target.at }} />;
    case "detail":
      return <Link to="/recordings/r/$id" params={{ id: target.id }} />;
    case "live":
      return <Link to="/watch/live/$channel" params={{ channel: target.channel }} />;
    case "sources":
      return <Link to="/settings/$section" params={{ section: "sources" }} />;
    case "guide":
      return <Link to="/guide" />;
    case "library":
      return <Link to="/recordings" />;
    case "sheet":
      return undefined;
  }
}

function HeroActionButton({ action }: { action: HeroAction }) {
  const overlay = useOverlay();
  const link = targetLink(action.target);
  const { target } = action;
  const open =
    target.to === "sheet"
      ? () => overlay.open({ kind: "sheet", name: "prog", arg: target.programmeId })
      : undefined;
  const linkProps = link ? { render: link, nativeButton: false } : { onClick: open };
  if (action.kind === "info") {
    return (
      <span className="sk" data-hero-action="info">
        <IconButton variant="glass" size="lg" label={action.label} {...linkProps}>
          <Icon icon={InfoIcon} />
        </IconButton>
      </span>
    );
  }
  const label =
    action.short === undefined ? (
      action.label
    ) : (
      <>
        <span data-hero-long="">{action.label}</span>
        <span data-hero-short="">{action.short}</span>
      </>
    );
  return (
    <span className="sk" data-hero-action={action.kind}>
      <Button
        className="w-full"
        variant={action.kind === "primary" ? "primary" : "glass"}
        size="lg"
        icon={<HeroIconGlyph icon={action.icon} />}
        {...(action.kind === "fold" ? { "aria-label": action.label } : {})}
        {...linkProps}
      >
        {label}
      </Button>
    </span>
  );
}

function ReadLineText({ read }: { read: ReadLine }) {
  switch (read.kind) {
    case "text":
      return read.text;
    case "behind":
      return (
        <>
          {m.home_read_stopped_at({ start: new Date(read.stoppedAt) })}
          {" · "}
          <b data-tone="you">{read.behind}</b> {m.player_behind_live_label()}
        </>
      );
    case "next":
      return (
        <>
          {m.home_read_next_at()} <b>{formatClock(read.at)}</b>
          {", "}
          {m.home_read_in()} <b>{read.inText}</b>
          {"."}
        </>
      );
    case "position":
      return (
        // The timeline under it shows where; the line says only what is left.
        <>{m.recordings_time_left({ seconds: read.leftSeconds })}</>
      );
  }
}

/** The slot above the actions: the read line and the timeline. */
function HeroSlot({ view }: { view: HeroView }) {
  // Phones sideways have an 82 px slot: the timeline drops its band row there, like the player.
  const short = useMediaQuery(media.shortLandscape);
  return (
    <>
      <p className="sk-hide" data-hero-read="">
        {view.read === undefined ? null : <ReadLineText read={view.read} />}
      </p>
      <div className="sk-hide" data-hero-timeline="">
        {view.timeline === undefined ? null : (
          <Timeline
            data={short ? { ...view.timeline, bands: [] } : view.timeline}
            relative={view.relative}
          />
        )}
      </div>
    </>
  );
}

/** Onboarding's poster: a tilted wall of generated artwork behind the mark. */
function OnboardingWall({ titles }: { titles: readonly string[] }) {
  const pick = (index: number) => titles[index % Math.max(1, titles.length)] ?? "";
  return (
    <div data-hero-wall="">
      {[0, 1, 2].map((column) => (
        <div key={column} data-hero-wall-column={column}>
          {[0, 1, 2, 3].map((row) => (
            <Artwork key={row} subject={{ title: pick(column * 3 + row) }} noMark />
          ))}
        </div>
      ))}
      <span data-hero-wall-mark="">
        <Mark />
      </span>
    </div>
  );
}

/** The poster on the right from 1100 px. */
function HeroPoster({ art, wall }: { art: ArtworkSubject | undefined; wall: readonly string[] }) {
  return (
    <div data-hero-poster="" aria-hidden="true">
      {art === undefined ? <OnboardingWall titles={wall} /> : <Artwork subject={art} noMark />}
    </div>
  );
}

/**
 * The Home hero (SPEC §8.1): a cinema surface of one fixed height in every state. Slots are
 * reserved top to bottom (badges, eyebrow, title line box, two-line description, the 102 px
 * read-line and timeline slot, actions), anchored to the bottom, so changing state or switching
 * between parallel recordings moves nothing. The switcher has its own slot at the top.
 */
export function Hero({
  view,
  switcher,
  wall,
}: {
  view: HeroView;
  /** The parallel-recordings switcher, when more than one records. */
  switcher?: ReactNode;
  /** Titles for onboarding's artwork wall. */
  wall: readonly string[];
}) {
  return (
    <section data-surface="cine" data-home-hero="" data-state={view.kind} aria-label={view.label}>
      <div data-hero-stage="" aria-hidden="true">
        {view.art === undefined ? (
          <div data-hero-glow="" />
        ) : (
          <Artwork subject={view.art} noTitle noMark />
        )}
      </div>
      {switcher === undefined ? null : <div data-hero-switcher-slot="">{switcher}</div>}
      <div data-hero-content="">
        <Wrap data-hero-grid="">
          <div
            data-hero-inner=""
            id={heroPanelId}
            {...(switcher === undefined ? {} : { role: "tabpanel" })}
          >
            <div data-hero-badges="">
              {view.badges.map((badge) => (
                <span key={badge.text} className="sk" data-wide={badge.wide ? "" : undefined}>
                  <Badge tone={badge.tone}>{badge.text}</Badge>
                </span>
              ))}
            </div>
            <div data-hero-heading="">
              <p data-hero-eyebrow="">
                <Sk placeholder={view.eyebrow}>{view.eyebrow}</Sk>
              </p>
              <h1 data-hero-title="" title={view.title} {...titleSteps(view.title)}>
                <span data-hero-tline="">
                  <Sk data-hero-tt="" placeholder={view.title}>
                    {view.title}
                  </Sk>
                </span>
              </h1>
            </div>
            <p data-hero-desc="">
              <Sk placeholder={view.description}>{view.description}</Sk>
            </p>
            <div data-hero-slot="">
              <HeroSlot view={view} />
            </div>
            <div
              data-hero-actions=""
              data-folds={view.actions.some((a) => a.kind === "fold") ? "" : undefined}
            >
              {view.actions.map((action) => (
                <HeroActionButton key={`${action.kind}-${action.label}`} action={action} />
              ))}
            </div>
          </div>
          <HeroPoster art={view.art} wall={wall} />
        </Wrap>
      </div>
    </section>
  );
}
