import { DateTime, Effect } from "effect";
import { HttpApiBuilder, HttpApiSecurity } from "effect/http-api";
import {
  Conflict,
  type ConflictCode,
  csrfCookie,
  CurrentUser,
  Forbidden,
  InvalidInput,
  NotFound,
  type PlaybackSession,
  type RecordingEntry,
  type ServerEvent,
  sessionCookie,
} from "@slipstream/api";
import {
  type ExtraTimeDefaults,
  matcherProblems,
  PlaybackSessionId,
  RecordingId,
  type Rule,
  type RuleDraft,
  RuleId,
  type User,
  UserId,
} from "@slipstream/domain";
import { makeMockData, type MockData, toEntry } from "./fixtures.ts";

/** The password every fixture account accepts on the mock server. */
export const mockPassword = "living-room";

/** How the mock starts. */
export interface MockOptions {
  /** The moment the fixtures are built around; the current time by default. */
  readonly now?: number;
  /** Start before first-run setup, with no accounts. */
  readonly setupRequired?: boolean;
  /**
   * Treat requests without a session as Alex until someone signs out, so the dev mock opens
   * on Home. Off by default: tests sign in like a person would.
   */
  readonly autoSignIn?: boolean;
  /** The playlist playback sessions hand out; the dev server's test stream by default. */
  readonly playlistUrl?: string;
  /** The household's extra-time defaults (Settings › Recording); the fixture's by default. */
  readonly extraTime?: ExtraTimeDefaults;
}

export const cookieSecurity = HttpApiSecurity.apiKey({ key: sessionCookie, in: "cookie" });
export const csrfSecurity = HttpApiSecurity.apiKey({ key: csrfCookie, in: "cookie" });

export const now = () => DateTime.makeUnsafe(Date.now());

/**
 * What an endpoint the web never calls answers: the mock is a test double for the web's
 * screens, not a second server, so it leaves those to the real one (a 500, never silence).
 */
export const notInMock = Effect.die(new Error("not served by the web mock"));

export const notFound = (entity: NotFound["entity"], id: string) =>
  Effect.fail(new NotFound({ entity, id }));

export const conflict = (code: ConflictCode) => Effect.fail(new Conflict({ code }));

/** A rule from what a client sent, owned by the caller. */
export const draftRule = (input: RuleDraft, owner: UserId): Rule => ({
  ...input,
  id: RuleId.make(crypto.randomUUID()),
  ownerId: owner,
  createdAt: now(),
  offerDeclined: false,
});

/** Refuses what the domain says a rule must not be, the way the server will. */
export const checkMatcher = (rule: Pick<Rule, "matcher">) => {
  const problems = matcherProblems(rule.matcher).map((problem) => ({
    path: "matcher",
    code: problem._tag,
  }));
  return problems.length > 0 ? Effect.fail(new InvalidInput({ problems })) : Effect.void;
};

export const requireAdmin = Effect.gen(function* () {
  const user = yield* CurrentUser;
  if (user.role !== "admin") return yield* Effect.fail(new Forbidden());
  return user;
});

/**
 * The mock server's shared state and the helpers several groups use. Each group file
 * (`system.ts`, `auth.ts`, ...) takes this and returns its handlers.
 */
export interface MockContext {
  readonly options: MockOptions;
  readonly data: MockData;
  /** Session token to its user and CSRF token. */
  readonly sessions: Map<string, { readonly userId: UserId; readonly csrf: string }>;
  /** Passwords of accounts added through the API; fixture accounts use `mockPassword`. */
  readonly passwords: Map<UserId, string>;
  readonly playbackSessions: Map<PlaybackSessionId, PlaybackSession>;
  readonly listeners: Set<(event: ServerEvent) => void>;
  /** The user requests without a session count as (dev mock); cleared on sign-out. */
  autoUser: UserId | undefined;
  readonly publish: (event: ServerEvent) => void;
  readonly userById: (id: UserId | undefined) => User | undefined;
  readonly passwordOf: (id: UserId) => string;
  readonly signIn: (user: User) => ReturnType<typeof signInFor>;
  readonly personalise: (entry: RecordingEntry, user: User) => RecordingEntry;
  readonly regroupAll: () => void;
  readonly findRecording: (id: RecordingId) => Effect.Effect<RecordingEntry, NotFound>;
}

/** A session cookie and CSRF cookie for `user`, as the real server sets them. */
const signInFor = (sessions: MockContext["sessions"], user: User) =>
  Effect.gen(function* () {
    const token = crypto.randomUUID();
    const csrf = crypto.randomUUID();
    sessions.set(token, { userId: user.id, csrf });
    const common = { path: "/", sameSite: "lax" as const };
    yield* HttpApiBuilder.securitySetCookie(cookieSecurity, token, { ...common, httpOnly: true });
    yield* HttpApiBuilder.securitySetCookie(csrfSecurity, csrf, common);
    return { user, expiresAt: DateTime.makeUnsafe(Date.now() + 30 * 24 * 3_600_000) };
  });

/** Builds the shared state from the fixtures. */
export const makeMockContext = (options: MockOptions): MockContext => {
  const data = makeMockData(options.now ?? Date.now());
  if (options.setupRequired) data.users = [];
  /** Session token to its user and CSRF token. */
  const sessions = new Map<string, { readonly userId: UserId; readonly csrf: string }>();
  /** Passwords of accounts added through the API; fixture accounts use `mockPassword`. */
  const passwords = new Map<UserId, string>();
  const playbackSessions = new Map<PlaybackSessionId, PlaybackSession>();
  const listeners = new Set<(event: ServerEvent) => void>();
  const publish = (event: ServerEvent) => {
    for (const listener of listeners) listener(event);
  };
  const userById = (id: UserId | undefined): User | undefined =>
    data.users.find((candidate) => candidate.id === id);
  const passwordOf = (id: UserId) => passwords.get(id) ?? mockPassword;

  /** The caller's own watched state and position on a library entry. */
  const personalise = (entry: RecordingEntry, user: User): RecordingEntry => {
    const state = data.playback.find(
      (candidate) =>
        candidate.userId === user.id &&
        candidate.target._tag === "Recording" &&
        candidate.target.recordingId === entry.id,
    );
    return state === undefined
      ? entry
      : { ...entry, watched: state.watched, positionMillis: state.positionMillis };
  };

  /** Places every recording again, after collections or pins changed. */
  const regroupAll = () => {
    data.recordings = data.recordings.map((entry) => toEntry(entry, data, entry.sizeBytes));
  };

  const findRecording = (id: RecordingId) =>
    Effect.suspend(() => {
      const found = data.recordings.find((r) => r.id === id);
      return found ? Effect.succeed(found) : notFound("recording", id);
    });
  return {
    options,
    data,
    sessions,
    passwords,
    playbackSessions,
    listeners,
    autoUser: options.autoSignIn ? data.users[0]?.id : undefined,
    publish,
    userById,
    passwordOf,
    signIn: (user) => signInFor(sessions, user),
    personalise,
    regroupAll,
    findRecording,
  };
};
