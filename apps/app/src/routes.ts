import type { Href } from "expo-router";

/*
 * Where the app's pages are, for phone and TV alike: every link to a page with parameters is
 * built here, and a TV's "Open on your phone" turns the same href into a deep link.
 */

/** A recording's page, inside Recordings. */
export const recordingHref = (id: string): Href => ({
  pathname: "/recordings/[id]",
  params: { id },
});

/** A place of the library (a collection or a show), inside Recordings. */
export const groupHref = (key: string): Href => ({
  pathname: "/recordings/group/[key]",
  params: { key },
});

/** A series recording's page, inside Recordings. */
export const seriesHref = (id: string): Href => ({
  pathname: "/recordings/series/[id]",
  params: { id },
});

/** Where a new series recording is made. */
export const newSeriesHref: Href = "/recordings/series/new";

/** Where a series recording is edited. */
export const editSeriesHref = (id: string): Href => ({
  pathname: "/recordings/series/[id]/edit",
  params: { id },
});

/** Where a new source is added, inside Settings. */
export const newSourceHref: Href = "/settings/sources/new";

/** Where a source is edited. */
export const editSourceHref = (id: string): Href => ({
  pathname: "/settings/sources/[id]",
  params: { id },
});

/** Needs review: channels that look like one channel, to merge or keep apart. */
export const mergeReviewHref: Href = "/settings/sources/review/merge";

/** Needs review: streams the playlists dropped, and channels left without one. */
export const goneReviewHref: Href = "/settings/sources/review/gone";

/** The channel list. */
export const channelsHref: Href = "/settings/channels";

/** Where a channel's name and logo are changed. */
export const channelHref = (id: string): Href => ({
  pathname: "/settings/channels/[id]",
  params: { id },
});

/** Where a household profile is edited, inside Settings. */
export const profileHref = (id: string): Href => ({
  pathname: "/settings/users/[id]",
  params: { id },
});

/** Where a household profile is added (the profile page's id `new`). */
export const newProfileHref: Href = { pathname: "/settings/users/[id]", params: { id: "new" } };

/** Where a guest is invited. */
export const inviteHref: Href = "/settings/users/invite";

/** Where a guest's access is changed. */
export const guestHref = (id: string): Href => ({
  pathname: "/settings/users/guest/[id]",
  params: { id },
});

/** An href as a path, its `[param]` segments filled in and escaped. */
export const hrefPath = (href: Href): string => {
  if (typeof href === "string") return href;
  const params: Readonly<Record<string, unknown>> = href.params ?? {};
  return href.pathname.replace(/\[(\w+)\]/gu, (_, name: string) => {
    const value = params[name];
    return encodeURIComponent(
      typeof value === "string" || typeof value === "number" ? String(value) : "",
    );
  });
};

/** The app's own URL scheme, registered as `scheme` in app.json. */
const APP_SCHEME = "slipstream";

/**
 * A deep link into the phone app for one of its pages: `/settings/sources` gives
 * `slipstream://settings/sources`. expo-router maps the scheme's path onto its routes, so a
 * scanned link opens that page whether the app is running or not.
 */
export const phoneLink = (href: Href): string =>
  `${APP_SCHEME}://${hrefPath(href).replace(/^\/+/u, "")}`;
