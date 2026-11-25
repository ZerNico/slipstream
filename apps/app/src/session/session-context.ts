import { createContext, useContext } from "react";
import type { LoginResult } from "@slipstream/api";
import type { Effect } from "effect";
import type { Api, ApiRuntime } from "../api/client.ts";
import type {
  HouseholdProfile,
  PinResult,
  ProfilePick,
  StoredAccount,
  StoredServer,
  StoredSession,
} from "./accounts.ts";

/** What every screen can read about the connection and do to it. */
export interface Session {
  /** False until stored state has been read; screens wait for it. */
  readonly loaded: boolean;
  readonly stored: StoredSession;
  /** The profile in use, once one is signed in and (on shared devices) picked. */
  readonly account: StoredAccount | undefined;
  /** Whether "Who's watching?" should show before anything else. */
  readonly needsPicker: boolean;
  /** API runtime for the signed-in profile. */
  readonly runtime: ApiRuntime | undefined;
  /** API runtime without a token, for sign-in against the chosen server. */
  readonly publicRuntime: ApiRuntime | undefined;
  /**
   * API runtime that can read the household: the profile in use, or while "Who's watching?"
   * shows, the one used last on this device.
   */
  readonly householdRuntime: ApiRuntime | undefined;
  /**
   * Runs one API write (`apiActions`) as the profile in use. A refused token signs the profile
   * out, as it does for reads; rejects when nobody is signed in.
   */
  readonly runAction: <A, E>(effect: Effect.Effect<A, E, Api>) => Promise<A>;
  /** Applies the server's household profiles to the ones stored here (names, roles, PINs). */
  readonly syncHousehold: (household: readonly HouseholdProfile[]) => void;
  readonly chooseServer: (server: StoredServer) => void;
  readonly forgetServer: () => void;
  readonly signedIn: (result: LoginResult) => void;
  /**
   * Picks a profile on "Who's watching?" against the household as just read from the server:
   * uses it straight away when it has no PIN, else answers `NeedsPin` and the picker asks for
   * it (a profile with a PIN only opens through `unlockProfile`).
   */
  readonly pickProfile: (
    userId: string,
    household: readonly Pick<HouseholdProfile, "id" | "hasPin">[],
  ) => ProfilePick;
  /**
   * Checks a profile's PIN with the server, as that profile, and uses the profile only when the
   * PIN was right.
   */
  readonly unlockProfile: (userId: string, pin: string) => Promise<PinResult>;
  /** Shows "Who's watching?" again (Settings, "Switch profile"). */
  readonly switchProfile: () => void;
  /** Leaves the profile picker to add another profile (device-code sign-in). */
  readonly addProfile: () => void;
  /** Gives up adding a profile and goes back to the one in use. */
  readonly cancelAddProfile: () => void;
  readonly signOut: () => void;
  /**
   * The server refused this profile's token (revoked or expired): forgets the profile here, so
   * the app moves on to "Who's watching?" or sign-in.
   */
  readonly tokenRejected: (userId: string) => void;
  readonly setPickerEnabled: (enabled: boolean) => void;
  /** True while someone is adding a profile from the picker or settings. */
  readonly addingProfile: boolean;
}

/** The session context; `SessionProvider` fills it. */
export const SessionContext = createContext<Session | undefined>(undefined);

/** The session; only valid below `SessionProvider`. */
export const useSession = (): Session => {
  const session = useContext(SessionContext);
  if (session === undefined) throw new Error("useSession must be used inside SessionProvider");
  return session;
};

/** The signed-in profile's API runtime; only used on screens behind the sign-in guard. */
export const useApiRuntime = (): ApiRuntime => {
  const { runtime } = useSession();
  if (runtime === undefined) throw new Error("useApiRuntime needs a signed-in profile");
  return runtime;
};
