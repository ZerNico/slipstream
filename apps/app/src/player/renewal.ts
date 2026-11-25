import { renewalDelayMillis } from "@slipstream/domain";

/** A renewed playlist: its newly signed URL and when that token expires (epoch ms). */
export interface Renewed {
  readonly uri: string;
  readonly expiresAt: number;
}

/** What keeping one playback session's playlist token fresh needs. */
export interface RenewalOptions {
  /** When the current playlist token expires, epoch ms. */
  readonly expiresAt: number;
  /** Renews the session (an empty `updateSession`) and answers with the new playlist. */
  readonly renew: () => Promise<Renewed>;
  /** A new playlist URL to swap in, keeping the position. */
  readonly onRenewed: (uri: string) => void;
  /** Renewing after the server refused the playlist failed: playback cannot go on. */
  readonly onFailed: () => void;
  /** Epoch ms now; `Date.now` unless a test says otherwise. */
  readonly now?: () => number;
}

/** The renewal of one playback session, running until stopped. */
export interface Renewal {
  /**
   * The server refused the playlist or a segment (401/403): renews right away and swaps the new
   * URL in. Only once until playback works again, so a playlist the server keeps refusing ends
   * in the error screen instead of a loop. False when that one retry is already used.
   */
  readonly recover: () => boolean;
  /** Playback is running: after a successful renewal, a later refusal may retry once more. */
  readonly playing: () => void;
  /** Clears the timer; answers still in flight are ignored. */
  readonly stop: () => void;
}

/**
 * Keeps a playback session's signed playlist URL valid: renews it `renewalDelayMillis` before it
 * expires (the domain's five-minute lead, never sooner than its floor), swaps in the new URL and
 * schedules the next renewal from the new expiry, for as long as the session plays. A renewal
 * that fails tries again after the floor while the old token may still work.
 */
export const startRenewal = (options: RenewalOptions): Renewal => {
  const now = options.now ?? Date.now;
  let expiresAt = options.expiresAt;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let inFlight = false;
  /** A refusal asked for this renewal: failing it ends playback. */
  let recovering = false;
  /** The one retry after a refusal is used, until playback works on the renewed URL. */
  let retried = false;

  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const schedule = () => {
    clear();
    timer = setTimeout(renew, renewalDelayMillis(expiresAt, now()));
  };

  const renew = () => {
    clear();
    if (stopped || inFlight) return;
    inFlight = true;
    options.renew().then(
      (next) => {
        inFlight = false;
        if (stopped) return;
        recovering = false;
        expiresAt = next.expiresAt;
        options.onRenewed(next.uri);
        schedule();
      },
      () => {
        inFlight = false;
        if (stopped) return;
        if (recovering) {
          recovering = false;
          options.onFailed();
          return;
        }
        schedule();
      },
    );
  };

  schedule();
  return {
    recover: () => {
      if (stopped || retried) return false;
      retried = true;
      recovering = true;
      // A renewal already under way carries the new URL; otherwise renew now.
      renew();
      return true;
    },
    playing: () => {
      if (!recovering) retried = false;
    },
    stop: () => {
      stopped = true;
      clear();
    },
  };
};
