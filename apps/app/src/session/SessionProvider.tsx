import { UserId } from "@slipstream/domain";
import { useQueryClient } from "@tanstack/react-query";
import { Effect, Fiber, Stream } from "effect";
import { FetchHttpClient } from "effect/http";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { runAction } from "../api/actions.ts";
import { Api, makeApiRuntime, type ApiRuntime, type Connection } from "../api/client.ts";
import { applyCacheUpdate, liveCacheUpdates } from "../api/events.ts";
import { announceReplaced } from "../api/replaced.ts";
import { apiActions } from "../api/queries.ts";
import type { UnauthorizedSignal } from "../api/query-client.ts";
import { xhrTransport } from "../api/xhr-transport.ts";
import { useToast } from "../ui/toast.ts";
import {
  addAccount,
  decodeSession,
  emptySession,
  encodeSession,
  forgetServer,
  lastUsedAccount,
  needsProfilePicker,
  pinResult,
  type PinResult,
  profilePick,
  removeAccount,
  setServer,
  syncWithHousehold,
  touchAccount,
  type StoredSession,
} from "./accounts.ts";
import { SessionContext, type Session } from "./session-context.ts";
import { revokeToken } from "./sign-out.ts";

const STORAGE_KEY = "slipstream.session";

/** One runtime per connection, disposed when the connection changes or the app unmounts. */
const useRuntime = (connection: Connection | undefined): ApiRuntime | undefined => {
  const baseUrl = connection?.baseUrl;
  const token = connection?.token;
  const runtime = useMemo(
    () => (baseUrl === undefined ? undefined : makeApiRuntime({ baseUrl, token })),
    [baseUrl, token],
  );
  useEffect(
    () => () => {
      if (runtime !== undefined) void runtime.dispose();
    },
    [runtime],
  );
  return runtime;
};

/**
 * Holds the server, the profiles signed in on this device and the one in use. Persists them in
 * the device's secure storage (tokens never go to logs or plain storage), clears the query cache
 * whenever the profile changes, and keeps cached data fresh from the server's live events.
 * Writes run through `runAction`, which tells `unauthorized` about a refused token just like
 * the query cache does for reads.
 */
export const SessionProvider = ({
  unauthorized,
  children,
}: {
  readonly unauthorized: UnauthorizedSignal;
  readonly children: ReactNode;
}) => {
  const queryClient = useQueryClient();
  const [loaded, setLoaded] = useState(false);
  const [stored, setStored] = useState<StoredSession>(emptySession);
  const [pickedUserId, setPickedUserId] = useState<string | undefined>(undefined);
  const [addingProfile, setAddingProfile] = useState(false);
  const [pickRequested, setPickRequested] = useState(false);

  useEffect(() => {
    let cancelled = false;
    SecureStore.getItemAsync(STORAGE_KEY)
      .catch(() => null)
      .then((text) => {
        if (cancelled) return;
        setStored(decodeSession(text));
        setLoaded(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Write every change back; a storage failure keeps working from memory.
  useEffect(() => {
    if (loaded) SecureStore.setItemAsync(STORAGE_KEY, encodeSession(stored)).catch(() => undefined);
  }, [loaded, stored]);

  const needsPicker =
    (needsProfilePicker(stored, pickedUserId !== undefined) ||
      (pickRequested && stored.accounts.length > 1)) &&
    !addingProfile;
  const account = needsPicker
    ? undefined
    : (stored.accounts.find((candidate) => candidate.userId === pickedUserId) ??
      (addingProfile ? undefined : lastUsedAccount(stored)));
  const serverUrl = stored.server?.url;

  // While "Who's watching?" shows, the profile used last reads the household for the picker;
  // picking that profile then keeps the same runtime.
  const tokenAccount = account ?? (needsPicker ? lastUsedAccount(stored) : undefined);
  const tokenRuntime = useRuntime(
    serverUrl === undefined || tokenAccount === undefined
      ? undefined
      : { baseUrl: serverUrl, token: tokenAccount.token },
  );
  const runtime = account === undefined ? undefined : tokenRuntime;
  const publicRuntime = useRuntime(
    serverUrl === undefined ? undefined : { baseUrl: serverUrl, token: undefined },
  );

  /**
   * Every change of profile or server goes through here: a different profile sees different
   * recordings and rules, so the previous one's cache is dropped first.
   */
  const switchTo = useCallback(
    (change: () => void) => {
      queryClient.clear();
      change();
    },
    [queryClient],
  );

  /**
   * Forgets a profile on this device. The Stack guards then show "Who's watching?" when other
   * profiles remain, else sign-in.
   */
  const forgetAccount = useCallback(
    (userId: string) =>
      switchTo(() => {
        setPickedUserId((picked) => (picked === userId ? undefined : picked));
        setStored((session) => removeAccount(session, userId));
      }),
    [switchTo],
  );

  // Live updates: every server event updates the cached queries it affects, and a repeat that
  // replaced a recording is announced. A 401 means the token was revoked or expired; the
  // profile is forgotten.
  const token = account?.token;
  const accountUserId = account?.userId;
  const toast = useToast();
  useEffect(() => {
    if (serverUrl === undefined || token === undefined || accountUserId === undefined) return;
    const connection = { baseUrl: serverUrl, token };
    const fiber = Effect.runFork(
      Stream.runForEach(liveCacheUpdates(xhrTransport, connection), (update) =>
        Effect.promise(() => applyCacheUpdate(queryClient, update)).pipe(
          Effect.andThen(
            update.replaced === undefined
              ? Effect.void
              : announceReplaced(update.replaced, toast).pipe(
                  Effect.provide(Api.layer(connection)),
                ),
          ),
        ),
      ).pipe(
        Effect.catchTag("TokenRevoked", () => Effect.sync(() => forgetAccount(accountUserId))),
      ),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [serverUrl, token, accountUserId, queryClient, forgetAccount, toast]);

  const signOut = useCallback(() => {
    if (account === undefined) return;
    if (serverUrl !== undefined) {
      // On its own layer: forgetting the account disposes the profile's runtime right away.
      Effect.runPromise(
        revokeToken({ baseUrl: serverUrl, token: account.token }).pipe(
          Effect.provide(FetchHttpClient.layer),
        ),
      ).catch(() => undefined);
    }
    forgetAccount(account.userId);
  }, [account, serverUrl, forgetAccount]);

  /** Uses a profile now: the one place a pick becomes the profile in use. */
  const enterProfile = useCallback(
    (userId: string) =>
      switchTo(() => {
        const now = Date.now();
        setStored((session) => touchAccount(session, userId, now));
        setPickedUserId(userId);
        setPickRequested(false);
      }),
    [switchTo],
  );

  const unlockProfile = useCallback(
    async (userId: string, pin: string): Promise<PinResult> => {
      const target = stored.accounts.find((candidate) => candidate.userId === userId);
      if (serverUrl === undefined || target === undefined) return { _tag: "Failed" };
      // The PIN is checked as the profile itself, with its own device token.
      const own = makeApiRuntime({ baseUrl: serverUrl, token: target.token });
      const result = await runAction(own, apiActions.verifyPin(UserId.make(userId), pin), () =>
        forgetAccount(userId),
      ).then(
        () => pinResult(undefined),
        (error: unknown) => pinResult(error),
      );
      await own.dispose();
      if (result._tag === "Accepted") enterProfile(userId);
      return result;
    },
    [stored.accounts, serverUrl, forgetAccount, enterProfile],
  );

  // Stable while the profile stays, so effects that write (the player) do not restart.
  const runSessionAction = useCallback<Session["runAction"]>(
    (effect) =>
      runtime === undefined
        ? Promise.reject(new Error("No profile is signed in"))
        : runAction(runtime, effect, unauthorized.emit),
    [runtime, unauthorized],
  );

  const value = useMemo<Session>(
    () => ({
      loaded,
      stored,
      account,
      needsPicker,
      runtime,
      publicRuntime,
      householdRuntime: tokenRuntime,
      addingProfile,
      runAction: runSessionAction,
      syncHousehold: (household) => setStored((session) => syncWithHousehold(session, household)),
      chooseServer: (server) => switchTo(() => setStored((session) => setServer(session, server))),
      forgetServer: () =>
        switchTo(() => {
          setPickedUserId(undefined);
          setStored(forgetServer);
        }),
      signedIn: (result) =>
        switchTo(() => {
          const now = Date.now();
          setStored((session) => addAccount(session, result, now));
          setPickedUserId(result.user.id);
          setAddingProfile(false);
        }),
      pickProfile: (userId, household) => {
        const pick = profilePick(stored, userId, household);
        if (pick === "Enter") enterProfile(userId);
        return pick;
      },
      unlockProfile,
      switchProfile: () => setPickRequested(true),
      addProfile: () => {
        setPickRequested(false);
        setAddingProfile(true);
      },
      cancelAddProfile: () => setAddingProfile(false),
      signOut,
      tokenRejected: forgetAccount,
      setPickerEnabled: (enabled) =>
        setStored((session) => ({ ...session, pickerEnabled: enabled })),
    }),
    [
      loaded,
      stored,
      account,
      needsPicker,
      runtime,
      publicRuntime,
      tokenRuntime,
      addingProfile,
      runSessionAction,
      enterProfile,
      unlockProfile,
      switchTo,
      signOut,
      forgetAccount,
    ],
  );

  return <SessionContext value={value}>{children}</SessionContext>;
};
