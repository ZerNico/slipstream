import { useEffect, useState } from "react";
import { artworkStyle } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { Icon } from "~/ui/icon.tsx";
import { GeneratedIcon, ImageIcon, RecordingsIcon } from "~/ui/icons.ts";
import { cn } from "~/ui/utils.ts";
import { loadArtworkFonts } from "./artwork-fonts.ts";
import { sourceLabel } from "./source-label.ts";
import {
  type ArtworkSource,
  type ArtworkSubject,
  artworkFor,
  artworkTitle,
  artworkVars,
  mainLineStep,
} from "./generate.ts";

/** What the Artwork component draws. */
export interface ArtworkProps {
  readonly subject: ArtworkSubject;
  /** 16:9 (default), 2:3 or 1:1. The box never changes size, whatever the source. */
  readonly ratio?: "landscape" | "portrait" | "square";
  /** Leave out the generated title (inside sheets and the player, where the title follows). */
  readonly noTitle?: boolean;
  /** Leave out the channel mark in the corner. */
  readonly noMark?: boolean;
  /** Overrides the words on generated art (collections: "Collection" over the name). */
  readonly title?: { readonly kicker: string; readonly main: string; readonly sub?: string };
  readonly className?: string;
}

/**
 * Artwork for a programme, a recording, a rule or a collection (SPEC §7.4). Without a picture, a
 * programme or recording shows its channel: the logo large in the middle of a quiet card (its
 * short mark when it has no logo), as TV apps do, never the title the text next to it already
 * says. Collections and series recordings, which have no one channel, keep their name set in
 * type. That card is also the placeholder: a guide image or a frame from the recording fades in
 * over it on load, in the same box, so nothing moves; the channel then sits in the corner.
 */
export function Artwork({
  subject,
  ratio = "landscape",
  noTitle = false,
  noMark = false,
  title,
  className,
}: ArtworkProps) {
  useEffect(loadArtworkFonts, []);
  const source = artworkFor(subject);
  const kind = subject.style ?? artworkStyle(subject.categories ?? [], subject.title);
  const words = title
    ? { kicker: title.kicker, main: title.main, sub: title.sub ?? "" }
    : artworkTitle(subject.title, kind, m.artwork_film());
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const url = source.kind === "generated" ? null : source.url;
  const channel = subject.channel;
  // The channel card: a programme or recording with a channel, unless named words replace it.
  const channelCard = title === undefined && channel !== undefined && channel.mark !== "";
  return (
    <div
      className={cn("art sk-art", className)}
      data-kind={channelCard ? undefined : kind}
      data-channel-card={channelCard ? "" : undefined}
      data-ratio={ratio === "landscape" ? undefined : ratio}
      data-source={source.kind}
      style={artworkVars(subject, kind)}
      aria-hidden="true"
    >
      <div className="art-bg" />
      {/* The channel as the picture: its logo centred and large, else its short mark. */}
      {channelCard ? (
        <LogoOrMark className="art-channel" logoUrl={channel.logoUrl} mark={channel.mark} />
      ) : null}
      {channelCard || noTitle ? null : (
        <div className="art-title">
          {words.kicker === "" ? null : <div className="art-kicker">{words.kicker}</div>}
          <div className="art-main" data-step={mainLineStep(words.main) || undefined}>
            {words.main}
          </div>
          {words.sub === "" ? null : <div className="art-sub">{words.sub}</div>}
        </div>
      )}
      {url === null ? null : (
        <img
          className="art-image"
          src={url}
          alt=""
          decoding="async"
          loading="lazy"
          data-loaded={loadedUrl === url ? "" : undefined}
          onLoad={() => setLoadedUrl(url)}
        />
      )}
      {/* The corner shows nothing for a channel with neither a logo nor a mark. */}
      {noMark ||
      channel === undefined ||
      (channel.mark === "" && channel.logoUrl === undefined) ||
      (channelCard && url === null) ? null : (
        <LogoOrMark className="art-mark" logoUrl={channel.logoUrl} mark={channel.mark} />
      )}
    </div>
  );
}

/**
 * A channel's logo, else its short mark, in one element: a logo that fails to load falls back
 * to the mark in the same place, so a broken image never shows. `data-logo` marks the logo.
 */
function LogoOrMark({
  logoUrl,
  mark,
  className,
}: {
  logoUrl?: string | undefined;
  mark: string;
  className: string;
}) {
  const [broken, setBroken] = useState<string | null>(null);
  const logo = logoUrl !== undefined && logoUrl !== "" && logoUrl !== broken ? logoUrl : null;
  return (
    <span className={className} data-logo={logo === null ? undefined : ""} aria-hidden="true">
      {logo === null ? (
        mark
      ) : (
        <img src={logo} alt="" decoding="async" loading="lazy" onError={() => setBroken(logo)} />
      )}
    </span>
  );
}

/** Where a picture came from, as a pill on large artwork (hero poster, recording detail). */
export function SourceBadge({
  source,
  label,
  className,
}: {
  source: ArtworkSource;
  /** Words in place of the source's own (a skeleton keeps the last loaded badge's width). */
  label?: string | undefined;
  className?: string;
}) {
  const icon =
    source.kind === "guide" || source.kind === "online"
      ? ImageIcon
      : source.kind === "frame"
        ? RecordingsIcon
        : GeneratedIcon;
  return (
    <span className={cn("source-badge sk", className)}>
      <Icon icon={icon} size={14} />
      {label ?? sourceLabel(source)}
    </span>
  );
}

/**
 * A channel's logo chip: the logo image when there is one, else its short mark. Decorative: the
 * channel name is always next to it or in the control's label.
 */
export function ChannelLogo({
  mark,
  logoUrl,
  size = "md",
  className,
}: {
  mark: string;
  logoUrl?: string | undefined;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <LogoOrMark
      className={cn(
        "chlogo sk",
        size === "sm" && "chlogo-sm",
        size === "lg" && "chlogo-lg",
        className,
      )}
      logoUrl={logoUrl}
      mark={mark}
    />
  );
}
