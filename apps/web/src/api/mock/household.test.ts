import { afterEach, describe, expect, it } from "vitest";
import { UserId } from "@slipstream/domain";
import { clientsLayer, makeApi } from "../client.ts";
import { problemOf } from "../errors.ts";
import { makeMockServer } from "./server.ts";
import { mockInviteToken, mockPin, mockOrigin } from "./household.ts";

const origin = mockOrigin;

/** The shared client against a fresh mock, signed in as the admin fixture. */
const setup = () => {
  const server = makeMockServer({ autoSignIn: true });
  const api = makeApi(
    clientsLayer({
      baseUrl: origin,
      fetch: (input, init) => server.handler(new Request(input, init)),
    }),
  );
  return { server, api };
};

let dispose: (() => Promise<void>) | undefined;
afterEach(async () => {
  await dispose?.();
  dispose = undefined;
});

const rejection = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return problemOf(error);
  }
  throw new Error("expected the call to fail");
};

describe("household mock", () => {
  it("lists household profiles and keeps guests apart", async () => {
    const { server, api } = setup();
    dispose = async () => {
      await api.dispose();
      await server.dispose();
    };
    const profiles = await api.call((c) => c.profiles.list());
    expect(profiles.map((profile) => profile.displayName)).toEqual(["Alex", "Household", "Kim"]);
    expect(profiles.find((profile) => profile.displayName === "Kim")?.hasPin).toBe(true);
    const guests = await api.call((c) => c.guests.list());
    expect(guests.map((guest) => guest.displayName)).toEqual(["Tom"]);
  });

  it("asks for Kim's PIN, refuses a wrong one and switches with the right one", async () => {
    const { server, api } = setup();
    dispose = async () => {
      await api.dispose();
      await server.dispose();
    };
    const kim = UserId.make("kim");
    expect(
      await rejection(api.call((c) => c.profiles.switch({ params: { userId: kim }, payload: {} }))),
    ).toMatchObject({
      _tag: "ProfileLocked",
      requires: "pin",
    });
    expect(
      (
        await rejection(
          api.call((c) =>
            c.profiles.switch({ params: { userId: kim }, payload: { secret: "0000" } }),
          ),
        )
      )._tag,
    ).toBe("InvalidCredentials");
    const result = await api.call((c) =>
      c.profiles.switch({ params: { userId: kim }, payload: { secret: mockPin } }),
    );
    expect(result.user.displayName).toBe("Kim");
    const me = await api.call((c) => c.profiles.me());
    expect(me.id).toBe(kim);
  });

  it("shows a restricted profile only its own channels and what records on them", async () => {
    const { server, api } = setup();
    dispose = async () => {
      await api.dispose();
      await server.dispose();
    };
    const kim = UserId.make("kim");
    await api.call((c) =>
      c.profiles.switch({ params: { userId: kim }, payload: { secret: mockPin } }),
    );
    const channels = await api.call((c) => c.channels.list({ query: {} }));
    expect(channels.map((channel) => channel.id).toSorted()).toEqual(["das-erste", "zdf"]);
    const recordings = await api.call((c) => c.recordings.list({ query: {} }));
    expect(recordings.length).toBeGreaterThan(0);
    expect(recordings.filter((entry) => !["das-erste", "zdf"].includes(entry.channelId))).toEqual(
      [],
    );
  });

  it("creates an invite whose link a guest can accept once", async () => {
    const { server, api } = setup();
    dispose = async () => {
      await api.dispose();
      await server.dispose();
    };
    const preview = await api.call((c) =>
      c.invites.lookup({ payload: { token: mockInviteToken } }),
    );
    expect(preview).toMatchObject({ name: "Lisa", invitedBy: "Alex" });
    const signedIn = await api.call((c) =>
      c.invites.accept({
        payload: { token: mockInviteToken, username: "lisa", password: "a-long-password" },
      }),
    );
    expect(signedIn.user.displayName).toBe("Lisa");
    expect(
      await rejection(api.call((c) => c.invites.lookup({ payload: { token: mockInviteToken } }))),
    ).toMatchObject({ _tag: "InviteInvalid", reason: "used" });
  });

  it("refuses recording defaults with two overrides for one category", async () => {
    const { server, api } = setup();
    dispose = async () => {
      await api.dispose();
      await server.dispose();
    };
    const settings = await api.call((c) => c.settings.recording());
    const sport = settings.extraTime.overrides[0];
    if (sport === undefined) throw new Error("expected the Sport override");
    const problem = await rejection(
      api.call((c) =>
        c.settings.saveRecording({
          payload: {
            ...settings,
            extraTime: {
              ...settings.extraTime,
              overrides: [...settings.extraTime.overrides, sport],
            },
          },
        }),
      ),
    );
    expect(problem).toMatchObject({
      _tag: "InvalidInput",
      problems: [{ path: "extraTime.overrides.3", code: "duplicateCategory" }],
    });
  });
});
