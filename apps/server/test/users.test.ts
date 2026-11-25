/**
 * Household accounts through the profiles API: profiles with their own sign-in, account
 * management for admins, the last-admin and delete-self guards, password changes and resets,
 * approving a TV as another profile with the device-code lookup.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Browser, startTestServer, type TestServer } from "./harness.ts";

let server: TestServer;
let admin: Browser;
let adminId: string;
const password = "correct horse battery staple";

beforeAll(async () => {
  server = await startTestServer();
  admin = new Browser(server.url);
  const setup = await admin.request("POST", "/api/auth/setup", {
    username: "admin",
    displayName: "Admin",
    password,
  });
  adminId = (setup.json as { user: { id: string } }).user.id;
});

afterAll(async () => {
  await server?.close();
});

const signIn = async (username: string, secret: string) => {
  const browser = new Browser(server.url);
  const result = await browser.request("POST", "/api/auth/login", {
    username,
    password: secret,
  });
  return { browser, status: result.status };
};

let kidId: string;

describe("profiles as accounts", () => {
  it("lets admins add profiles that sign in on their own, and refuses taken usernames", async () => {
    const created = await admin.request("POST", "/api/profiles", {
      displayName: "Kid",
      avatarTone: "green",
      login: { username: " Kid ", password: "kid password 1" },
    });
    expect(created.status).toBe(200);
    expect(created.json).toMatchObject({ displayName: "Kid", role: "user", kind: "household" });
    expect(created.text).not.toContain("password");
    kidId = (created.json as { id: string }).id;
    expect((await signIn("kid", "kid password 1")).status).toBe(200);

    const again = await admin.request("POST", "/api/profiles", {
      displayName: "Other",
      avatarTone: "teal",
      login: { username: "KID", password: "kid password 1" },
    });
    expect(again.status).toBe(409);
    expect(again.json).toMatchObject({ _tag: "Conflict", code: "usernameTaken" });

    const short = await admin.request("POST", "/api/profiles", {
      displayName: "Short",
      avatarTone: "teal",
      login: { username: "short", password: "tiny" },
    });
    expect(short.status).toBe(400);

    // An admin with a password needs no PIN; one without either could never be switched to.
    const lockless = await admin.request("POST", "/api/profiles", {
      displayName: "Boss",
      avatarTone: "rose",
      role: "admin",
    });
    expect(lockless.json).toMatchObject({ problems: [{ path: "pin", code: "requiredForAdmin" }] });
  });

  it("lists profiles for everyone and lets only admins add them", async () => {
    const { browser: kid } = await signIn("kid", "kid password 1");
    const profiles = (await kid.request("GET", "/api/profiles")).json as Array<{ id: string }>;
    expect(profiles.map((profile) => profile.id)).toEqual([adminId, kidId]);
    expect(JSON.stringify(profiles)).not.toContain("username");
    expect(
      (
        await kid.request("POST", "/api/profiles", {
          displayName: "Sneaky",
          avatarTone: "rose",
          role: "admin",
          login: { username: "sneaky", password: "sneaky password" },
        })
      ).status,
    ).toBe(403);
  });

  it("lets people rename themselves and change their password with the current one", async () => {
    const { browser: kid } = await signIn("kid", "kid password 1");
    expect(
      (await kid.request("PATCH", `/api/profiles/${kidId}`, { displayName: "Kiddo" })).json,
    ).toMatchObject({ displayName: "Kiddo" });
    expect((await kid.request("PATCH", `/api/profiles/${kidId}`, { role: "admin" })).status).toBe(
      403,
    );
    expect(
      (await kid.request("PATCH", `/api/profiles/${adminId}`, { displayName: "Boss" })).status,
    ).toBe(403);

    const missing = await kid.request("PATCH", `/api/profiles/${kidId}`, {
      password: "kid password 2",
    });
    expect(missing.json).toMatchObject({
      problems: [{ path: "currentPassword", code: "required" }],
    });
    const wrong = await kid.request("PATCH", `/api/profiles/${kidId}`, {
      password: "kid password 2",
      currentPassword: "nope",
    });
    expect(wrong.status).toBe(422);
    expect(wrong.json).toMatchObject({
      problems: [{ path: "currentPassword", code: "incorrect" }],
    });
    const changed = await kid.request("PATCH", `/api/profiles/${kidId}`, {
      password: "kid password 2",
      currentPassword: "kid password 1",
    });
    expect(changed.status).toBe(200);
    expect((await signIn("kid", "kid password 1")).status).toBe(401);
    expect((await signIn("kid", "kid password 2")).status).toBe(200);
  });

  it("ends someone's browser sessions when an admin resets their password", async () => {
    const { browser: kid } = await signIn("kid", "kid password 2");
    expect((await kid.request("GET", "/api/profiles/me")).status).toBe(200);
    const reset = await admin.request("PATCH", `/api/profiles/${kidId}`, {
      password: "kid password 3",
    });
    expect(reset.status).toBe(200);
    expect((await kid.request("GET", "/api/profiles/me")).status).toBe(401);
    expect((await signIn("kid", "kid password 3")).status).toBe(200);
  });

  it("keeps the last admin and refuses deleting oneself", async () => {
    const demote = await admin.request("PATCH", `/api/profiles/${adminId}`, { role: "user" });
    expect(demote.json).toMatchObject({ _tag: "Conflict", code: "lastAdmin" });
    const self = await admin.request("DELETE", `/api/profiles/${adminId}`);
    expect(self.json).toMatchObject({ _tag: "Conflict", code: "deleteSelf" });
    expect((await admin.request("DELETE", "/api/profiles/nobody")).status).toBe(404);
  });
});

/** A TV that started a device-code sign-in, with its codes. */
const startCode = async () => {
  const tv = new Browser(server.url);
  const grant = (await tv.request("POST", "/api/auth/device-code", {
    name: "Kids Room TV",
    kind: "tv",
  })) as { json: { deviceCode: string; userCode: string } };
  return { tv, ...grant.json };
};

describe("device-code sign-in as another profile", () => {
  it("shows the waiting TV, and lets an admin sign it in as the kid", async () => {
    const { tv, deviceCode, userCode } = await startCode();
    const pending = await admin.request("GET", `/api/auth/device-code/${userCode}`);
    expect(pending.json).toMatchObject({
      userCode,
      device: { name: "Kids Room TV", kind: "tv" },
    });
    expect((await admin.request("GET", "/api/auth/device-code/ZZZZ-ZZZZ")).status).toBe(404);

    const approved = await admin.request("POST", "/api/auth/device-code/approve", {
      userCode,
      approve: true,
      userId: kidId,
    });
    expect(approved.json).toEqual({
      device: { name: "Kids Room TV", kind: "tv" },
      userId: kidId,
    });
    const token = await tv.request("POST", "/api/auth/device-code/token", { deviceCode });
    expect(token.json).toMatchObject({ user: { id: kidId } });

    // Used up: the code is gone.
    expect((await admin.request("GET", `/api/auth/device-code/${userCode}`)).status).toBe(404);
  });

  it("refuses a non-admin signing a TV in as someone else, and blocks on request", async () => {
    const { userCode } = await startCode();
    const { browser: kid } = await signIn("kid", "kid password 3");
    const forbidden = await kid.request("POST", "/api/auth/device-code/approve", {
      userCode,
      approve: true,
      userId: adminId,
    });
    expect(forbidden.status).toBe(403);
    const blocked = await kid.request("POST", "/api/auth/device-code/approve", {
      userCode,
      approve: false,
    });
    expect(blocked.json).toEqual({ device: { name: "Kids Room TV", kind: "tv" } });
  });

  it("deletes an account with its devices", async () => {
    expect((await admin.request("DELETE", `/api/profiles/${kidId}`)).status).toBe(204);
    const devices = (await admin.request("GET", "/api/devices")).json as Array<{
      userId: string;
    }>;
    expect(devices.filter((device) => device.userId === kidId)).toEqual([]);
    expect((await signIn("kid", "kid password 3")).status).toBe(401);
  });
});
