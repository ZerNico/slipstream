import { useQuery } from "@tanstack/react-query";
import {
  type AccessPolicy,
  type ExtraTimeDefaults,
  fullAccess,
  initialExtraTimeDefaults,
  type UserId,
} from "@slipstream/domain";
import { useQueries } from "./hooks.ts";

/** Who is looking: the signed-in profile, whether it acts as an admin, and what it may see and do. */
export interface Viewer {
  readonly id: UserId | undefined;
  readonly displayName: string | undefined;
  /** The session's role: a household device never acts as an admin. */
  readonly isAdmin: boolean;
  /**
   * What the profile may see and record into (SPEC §7.8). A server that cannot say restricts
   * nobody, so the fallback is full access; the server enforces the real policy.
   */
  readonly access: AccessPolicy;
  /** Both reads answered (or failed). */
  readonly settled: boolean;
}

/** The viewer, from the signed-in account and its profile. */
export function useViewer(): Viewer {
  const queries = useQueries();
  const me = useQuery(queries.me());
  const profile = useQuery(queries.myProfile());
  return {
    id: me.data?.id,
    displayName: profile.data?.displayName ?? me.data?.displayName,
    isAdmin: (profile.data?.role ?? me.data?.role) === "admin",
    access: profile.data?.access ?? fullAccess,
    settled: !me.isPending && !profile.isPending,
  };
}

/**
 * The household's recording defaults (Settings › Recording, SPEC §7.7). Everyone reads them; a
 * server that cannot say, or no answer yet, means the defaults the product ships with.
 */
export function useRecordingDefaults(): {
  readonly defaults: ExtraTimeDefaults;
  readonly settled: boolean;
} {
  const query = useQuery(useQueries().recordingSettings());
  return {
    defaults: query.data?.extraTime ?? initialExtraTimeDefaults,
    settled: !query.isPending,
  };
}
