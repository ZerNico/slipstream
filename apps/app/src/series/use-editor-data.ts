import {
  type AccessPolicy,
  canCreateCollections,
  type Channel,
  type Collection,
  type ExtraTimeDefaults,
  fullAccess,
  initialExtraTimeDefaults,
  pickableChannels,
  type Rule,
  type UserId,
} from "@slipstream/domain";
import { useQuery } from "@tanstack/react-query";
import { useApiQueries } from "../data/hooks.ts";

/** Everything the editor reads besides its draft, loaded once for the screen. */
export interface EditorData {
  /** The saved series recording; undefined for a new one. */
  readonly rule: Rule | undefined;
  /** Every channel this profile may pick, in guide order. */
  readonly channels: readonly Channel[];
  readonly collections: readonly Collection[];
  readonly viewer: { readonly id: UserId | undefined; readonly isAdmin: boolean };
  readonly defaults: ExtraTimeDefaults;
  readonly access: AccessPolicy;
  /** May create collections ("New collection…"). */
  readonly mayEditCollections: boolean;
}

/**
 * What the editor of one series recording (or a new one) reads: the rule from the cached list,
 * the channels this profile may pick, the collections, who is looking, the extra-time defaults
 * and the profile's access. Defaults and access fall back to the built-in ones when the server
 * cannot say; it enforces the real policy.
 */
export const useEditorData = (ruleId: string | undefined) => {
  const queries = useApiQueries();
  const rules = useQuery({ ...queries.rules(), enabled: ruleId !== undefined });
  const channels = useQuery(queries.channels());
  const collections = useQuery(queries.collections());
  const me = useQuery(queries.me());
  const settings = useQuery(queries.recordingSettings());
  const profile = useQuery(queries.myProfile());
  const access = profile.data?.access ?? fullAccess;
  const loading =
    (ruleId !== undefined && rules.isPending) ||
    channels.isPending ||
    me.isPending ||
    settings.isPending ||
    profile.isPending ||
    // Goes to names the collections; a read that failed still lets the editor open.
    (collections.isPending && collections.errorUpdateCount === 0);
  const data: EditorData = {
    rule: rules.data?.find((rule) => rule.id === ruleId),
    channels: pickableChannels(channels.data ?? [], access),
    collections: collections.data ?? [],
    viewer: { id: me.data?.id, isAdmin: me.data?.role === "admin" },
    defaults: settings.data?.extraTime ?? initialExtraTimeDefaults,
    access,
    mayEditCollections: me.data !== undefined && canCreateCollections(me.data),
  };
  return {
    data,
    /** Every channel by id, hidden ones too, so a saved rule's channels keep their names. */
    allChannels: channels.data ?? [],
    loading,
    error: (ruleId === undefined ? null : rules.error) ?? channels.error,
    retry: () => {
      void rules.refetch();
      void channels.refetch();
    },
  };
};
