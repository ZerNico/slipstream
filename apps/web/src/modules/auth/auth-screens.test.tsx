// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { mockInviteToken } from "~/api/mock/household.ts";
import { mountWithMock } from "~/modules/settings/test-support.tsx";
import { passwordStrength, safeRedirect } from "./auth-text.ts";
import { InvitePage } from "./invite-page.tsx";
import { LoginPage } from "./login-page.tsx";

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
  document.body.innerHTML = "";
});

/** Types into a controlled input the way a browser does. */
const type = (input: HTMLInputElement | null, value: string) => {
  if (input === null) throw new Error("no input");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("auth helpers", () => {
  it("only goes back to paths on this site", () => {
    expect(safeRedirect("/guide?day=1")).toBe("/guide?day=1");
    expect(safeRedirect("//evil.example")).toBe(undefined);
    expect(safeRedirect("https://evil.example")).toBe(undefined);
  });

  it("rates passwords from too short to strong", () => {
    expect(passwordStrength("short")).toBe(0);
    expect(passwordStrength("aaaaaaaaaa")).toBe(1);
    expect(passwordStrength("Correct-Horse-Battery-9")).toBe(4);
  });
});

describe("sign-in", () => {
  it("says a wrong password under the password field", async () => {
    const view = await mountWithMock(<LoginPage redirect={undefined} />, "/login");
    cleanup = view.cleanup;
    type(document.querySelector("#login-username"), "alex");
    type(document.querySelector("#login-password"), "not-it");
    await view.settle();
    await view.click(document.querySelector('button[type="submit"]'));
    await view.waitFor(() =>
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        "Wrong username or password.",
      ),
    );
  });
});

describe("guest invite", () => {
  it("names who invited and creates the guest account", async () => {
    const view = await mountWithMock(<InvitePage token={mockInviteToken} />, "/invite");
    cleanup = view.cleanup;
    await view.waitFor(() => expect(view.text()).toContain("Alex invited you to Slipstream"));
    expect(document.querySelector<HTMLInputElement>("#invite-name")?.value).toBe("Lisa");
    type(document.querySelector("#invite-username"), "lisa");
    type(document.querySelector("#invite-password"), "a-long-password");
    await view.settle();
    await view.click(document.querySelector('button[type="submit"]'));
    await view.waitFor(() =>
      expect(view.server.data.users.some((user) => user.username === "lisa")).toBe(true),
    );
  });

  it("says a used invite can't be used", async () => {
    const view = await mountWithMock(<InvitePage token="nope" />, "/invite");
    cleanup = view.cleanup;
    await view.waitFor(() => expect(view.text()).toContain("This invite link isn't valid."));
  });
});
