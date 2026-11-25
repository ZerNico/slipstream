import {
  Forbidden,
  InvalidCredentials,
  LoginResult,
  RateLimited,
  Unauthorized,
} from "@slipstream/api";
import { isPin, UserId } from "@slipstream/domain";
import { Effect, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { describe, expect, it } from "vitest";
import {
  addAccount,
  decodeSession,
  emptySession,
  encodeSession,
  forgetServer,
  lastUsedAccount,
  needsProfilePicker,
  pinResult,
  profileNeedsPin,
  profilePick,
  profilesInOrder,
  profilesNotHere,
  removeAccount,
  setServer,
  syncWithHousehold,
  touchAccount,
  typePinDigit,
} from "./accounts.ts";
import { runAction } from "../api/actions.ts";
import { makeApiRuntime } from "../api/client.ts";
import { apiActions } from "../api/queries.ts";

const login = (id: string, token: string | undefined, role = "user") =>
  Schema.decodeUnknownSync(LoginResult)({
    user: {
      id,
      username: id,
      displayName: id.toUpperCase(),
      role,
      createdAt: "2026-11-01T00:00:00Z",
    },
    ...(token === undefined ? {} : { token }),
    expiresAt: "2027-11-01T00:00:00Z",
  });

const server = { url: "http://unraid:8080", name: "unraid" };

describe("accounts", () => {
  it("adds a profile per person and replaces an older token", () => {
    let session = setServer(emptySession, server);
    session = addAccount(session, login("alex", "t1", "admin"), 1);
    session = addAccount(session, login("kim", "t2"), 2);
    session = addAccount(session, login("alex", "t3", "admin"), 3);
    expect(session.accounts.map((account) => [account.userId, account.token])).toEqual([
      ["kim", "t2"],
      ["alex", "t3"],
    ]);
  });

  it("ignores a login without a device token", () => {
    expect(addAccount(emptySession, login("alex", undefined), 1)).toBe(emptySession);
  });

  it("orders profiles by last use and picks the last one", () => {
    let session = addAccount(emptySession, login("alex", "t1"), 1);
    session = addAccount(session, login("kim", "t2"), 2);
    session = touchAccount(session, "alex", 5);
    expect(profilesInOrder(session).map((account) => account.userId)).toEqual(["alex", "kim"]);
    expect(lastUsedAccount(session)?.userId).toBe("alex");
    expect(lastUsedAccount(removeAccount(session, "alex"))?.userId).toBe("kim");
  });

  it("asks who is watching only on shared devices, once per launch, unless turned off", () => {
    const one = addAccount(emptySession, login("alex", "t1"), 1);
    const two = addAccount(one, login("kim", "t2"), 2);
    expect(needsProfilePicker(one, false)).toBe(false);
    expect(needsProfilePicker(two, false)).toBe(true);
    expect(needsProfilePicker(two, true)).toBe(false);
    expect(needsProfilePicker({ ...two, pickerEnabled: false }, false)).toBe(false);
  });

  it("signs everyone out when the server changes, but not when it is the same one", () => {
    const session = addAccount(setServer(emptySession, server), login("alex", "t1"), 1);
    expect(setServer(session, { ...server, name: "renamed" }).accounts).toHaveLength(1);
    expect(setServer(session, { url: "http://other", name: "other" }).accounts).toEqual([]);
    expect(forgetServer(session)).toEqual({ accounts: [], pickerEnabled: true });
  });

  it("round-trips through storage and starts over on garbage", () => {
    const session = addAccount(setServer(emptySession, server), login("alex", "t1", "admin"), 7);
    expect(decodeSession(encodeSession(session))).toEqual(session);
    expect(decodeSession(null)).toEqual(emptySession);
    expect(decodeSession("{not json")).toEqual(emptySession);
    expect(decodeSession('{"accounts":"nope"}')).toEqual(emptySession);
  });
});

describe("household", () => {
  const household = [
    { id: UserId.make("alex"), displayName: "Alex", role: "admin", hasPin: false },
    { id: UserId.make("house"), displayName: "Household", role: "user", hasPin: false },
    { id: UserId.make("kim"), displayName: "Kim B.", role: "admin", hasPin: true },
  ] as const;

  it("takes names and roles from the server and drops deleted accounts", () => {
    let session = addAccount(emptySession, login("alex", "t1", "admin"), 1);
    session = addAccount(session, login("kim", "t2"), 2);
    session = addAccount(session, login("gone", "t3"), 3);
    const synced = syncWithHousehold(session, household);
    expect(
      synced.accounts.map((a) => [a.userId, a.displayName, a.role, a.token, a.hasPin ?? false]),
    ).toEqual([
      ["alex", "Alex", "admin", "t1", false],
      ["kim", "Kim B.", "admin", "t2", true],
    ]);
    expect(syncWithHousehold(synced, household)).toBe(synced);
  });

  it("lists household profiles not signed in here yet", () => {
    const session = addAccount(emptySession, login("alex", "t1", "admin"), 1);
    expect(profilesNotHere(session, household).map((profile) => profile.id)).toEqual([
      "house",
      "kim",
    ]);
  });

  it("keeps a PIN the household dropped or added in line", () => {
    const session = syncWithHousehold(addAccount(emptySession, login("kim", "t2"), 1), household);
    expect(session.accounts[0]?.hasPin).toBe(true);
    const removed = household.map((profile) => ({ ...profile, hasPin: false }));
    expect(syncWithHousehold(session, removed).accounts[0]?.hasPin).toBe(false);
  });
});

describe("PIN gate", () => {
  const kim = { userId: "kim", hasPin: true };
  const alex = { userId: "alex" };

  it("asks for a PIN when the household says so, else as stored", () => {
    const household = [
      { id: UserId.make("kim"), hasPin: true },
      { id: UserId.make("alex"), hasPin: false },
    ];
    expect(profileNeedsPin(alex, household)).toBe(false);
    expect(profileNeedsPin({ userId: "alex", hasPin: true }, household)).toBe(false);
    expect(profileNeedsPin({ userId: "kim", hasPin: false }, household)).toBe(true);
    // The household could not be read: what it said last still counts.
    expect(profileNeedsPin(kim, [])).toBe(true);
    expect(profileNeedsPin(alex, [])).toBe(false);
  });

  it("lets a profile in only when the server accepted the PIN", () => {
    expect(pinResult(undefined)).toEqual({ _tag: "Accepted" });
    expect(pinResult(new InvalidCredentials())).toEqual({ _tag: "Wrong" });
    expect(pinResult(new RateLimited({ retryAfterSeconds: 90 }))).toEqual({
      _tag: "RateLimited",
      retryAfterSeconds: 90,
    });
    expect(pinResult(new Unauthorized())).toEqual({ _tag: "SignedOut" });
    expect(pinResult(new Forbidden())).toEqual({ _tag: "Failed" });
    expect(pinResult(new Error("offline"))).toEqual({ _tag: "Failed" });
  });

  it("takes four digits at most and deletes the last one", () => {
    let pin = "";
    for (const digit of [1, 2, 3, 4, 5]) pin = typePinDigit(pin, digit);
    expect(pin).toBe("1234");
    expect(typePinDigit(pin, "delete")).toBe("123");
    expect(typePinDigit("", "delete")).toBe("");
    expect(typePinDigit("1", 12)).toBe("1");
    expect(isPin(pin)).toBe(true);
    expect(isPin(typePinDigit(pin, "delete"))).toBe(false);
  });

  it("routes a pick to the PIN whenever the fresh household says the profile has one", () => {
    // Stored before kim set a PIN: the household just read decides.
    let session = addAccount(emptySession, login("kim", "t2"), 1);
    session = addAccount(session, login("alex", "t1"), 2);
    const household = [
      { id: UserId.make("kim"), hasPin: true },
      { id: UserId.make("alex"), hasPin: false },
    ];
    expect(profilePick(session, "kim", household)).toBe("NeedsPin");
    expect(profilePick(session, "alex", household)).toBe("Enter");
    expect(profilePick(session, "kim", [])).toBe("Enter");
    expect(profilePick(session, "sam", household)).toBe("Gone");
  });

  it("checks the PIN with the server as the profile, refusing a wrong one", async () => {
    const seen: { url: string; authorization: string | null; body: string }[] = [];
    const answer = (status: number, body: unknown) => {
      const fetch = async (input: string | Request, init?: RequestInit) => {
        const request = new Request(input, init);
        seen.push({
          url: request.url,
          authorization: request.headers.get("authorization"),
          body: await request.text(),
        });
        return new Response(body === undefined ? null : JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });
      };
      return Effect.provideService(FetchHttpClient.Fetch, fetch as typeof globalThis.fetch);
    };
    const runtime = makeApiRuntime({ baseUrl: "http://tv.local", token: "kim-token" });
    const check = (status: number, body: unknown) =>
      runAction(
        runtime,
        apiActions.verifyPin(UserId.make("kim"), "1234").pipe(answer(status, body)),
        () => undefined,
      ).then(
        () => pinResult(undefined),
        (error: unknown) => pinResult(error),
      );
    expect(await check(204, undefined)).toEqual({ _tag: "Accepted" });
    expect(await check(401, { _tag: "InvalidCredentials" })).toEqual({ _tag: "Wrong" });
    expect(await check(429, { _tag: "RateLimited", retryAfterSeconds: 30 })).toEqual({
      _tag: "RateLimited",
      retryAfterSeconds: 30,
    });
    await runtime.dispose();
    expect(seen[0]).toEqual({
      url: "http://tv.local/api/profiles/kim/pin/verify",
      authorization: "Bearer kim-token",
      body: JSON.stringify({ pin: "1234" }),
    });
  });
});
