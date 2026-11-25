// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { optionLabels, pickOption, selectedText, selectTrigger } from "~/test/select.ts";
import { DateTime } from "effect";
import { UserId, type User } from "@slipstream/domain";
import { mockPin } from "~/api/mock/household.ts";
import type { OverlayComponentProps } from "~/shell/overlay-host.tsx";
import { defaultPrefs, prefKeys, readPrefs, savePrefs } from "~/modules/watch/player-prefs.ts";
import { autosaveDelay } from "./use-autosave.ts";
import { DeviceSection } from "./device-section.tsx";
import { PlaybackSection } from "./playback-section.tsx";
import PinDialog from "./pin-dialog.tsx";
import { RecordingSection } from "./recording-section.tsx";
import { mountWithMock } from "./test-support.tsx";
import { UsersSection } from "./users-section.tsx";

const alex: User = {
  id: UserId.make("alex"),
  username: "alex",
  displayName: "Alex",
  role: "admin",
  createdAt: DateTime.makeUnsafe(0),
};

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
  document.body.innerHTML = "";
});

const button = (name: string) =>
  [...document.querySelectorAll<HTMLElement>("button, [role=button]")].find(
    (element) =>
      element.getAttribute("aria-label") === name || element.textContent?.trim() === name,
  );

describe("Users & devices", () => {
  it("shows the household with Add profile last, guests, invites and devices", async () => {
    const view = await mountWithMock(<UsersSection me={alex} channels={[]} collections={[]} />);
    cleanup = view.cleanup;
    await view.waitFor(() => expect(view.text()).toContain("Invite for Lisa"));
    const text = view.text();
    expect(text).toContain("Alex · you");
    expect(text).toContain("Kim");
    expect(text).toContain("Tom");
    expect(text).toContain("Living Room Shield");
    const cards = [...view.host.querySelectorAll(".panel, button")].map((el) => el.textContent);
    expect(cards.findIndex((t) => t?.includes("Add profile"))).toBeGreaterThan(
      cards.findIndex((t) => t?.includes("Kim")),
    );
  });

  it("revokes a device with an inline confirm and says it is signed out", async () => {
    const view = await mountWithMock(<UsersSection me={alex} channels={[]} collections={[]} />);
    cleanup = view.cleanup;
    await view.waitFor(() => expect(button('Sign out "Pixel 9"')).toBeDefined());
    await view.click(button('Sign out "Pixel 9"'));
    const confirm = document.querySelector("button.btn-danger");
    expect(document.activeElement).toBe(confirm);
    await view.click(confirm);
    await view.waitFor(() => expect(view.text()).toContain("Signed out"));
    expect(view.server.data.devices.some((device) => device.name === "Pixel 9")).toBe(false);
  });

  it("opens the invite dialog from the URL", async () => {
    const view = await mountWithMock(
      <UsersSection me={alex} channels={[]} collections={[]} />,
      "/?dlg=invite",
    );
    cleanup = view.cleanup;
    await view.waitFor(() => expect(view.text()).toContain("Copy invite link"));
    expect(view.text()).toContain("Link expires");
  });
});

const startEarly = () => selectTrigger(document, "Start early");

const running = () =>
  selectTrigger(document, "Keep a channel running after the last viewer leaves");
const buffer = () => selectTrigger(document, "Keep the rewind buffer after it stops");

describe("Recording defaults", () => {
  it("saves a changed value on its own shortly after", async () => {
    const view = await mountWithMock(<RecordingSection />);
    cleanup = view.cleanup;
    await view.waitFor(() => expect(startEarly()?.disabled).toBe(false));
    await pickOption(startEarly(), "5 min");
    await view.settle(autosaveDelay + 200);
    await view.waitFor(() =>
      expect(view.server.data.household.recording.extraTime.padding.beforeMinutes).toBe(5),
    );
  });

  it("keeps live TV running and its rewind buffer as long as picked", async () => {
    const view = await mountWithMock(<RecordingSection />);
    cleanup = view.cleanup;
    await view.waitFor(() => expect(running()?.disabled).toBe(false));
    expect(view.text()).toContain("Live TV");
    expect(selectedText(running())).toBe("10 min");
    expect(selectedText(buffer())).toBe("1 h");
    expect(await optionLabels(running())).toEqual([
      "1 min",
      "5 min",
      "10 min",
      "15 min",
      "30 min",
      "1 h",
      "Until the programme ends",
    ]);
    await pickOption(running(), "Until the programme ends");
    await pickOption(buffer(), "Don’t keep");
    await view.settle(autosaveDelay + 200);
    await view.waitFor(() =>
      expect(view.server.data.household.live).toEqual({
        keepRunning: "programmeEnd",
        keepBufferMinutes: 0,
      }),
    );
  });
});

const quality = () => selectTrigger(document, "Quality");

describe("This device", () => {
  afterEach(() => {
    savePrefs({ quality: defaultPrefs.quality });
  });

  it("offers Default and says what it is now, and stores a pick as the player's own", async () => {
    savePrefs({ quality: "auto" });
    const view = await mountWithMock(<DeviceSection />);
    cleanup = view.cleanup;
    await view.waitFor(() => expect(view.text()).toContain("At home Original, away Automatic"));
    expect(selectedText(quality())).toBe("Default");
    expect(view.text()).toContain("Theme");
    expect(view.text()).toContain("Language");
    await pickOption(quality(), "Original");
    expect(readPrefs(localStorage).quality).toBe("original");
    expect(localStorage.getItem(prefKeys.quality)).toBe("original");
    expect(view.text()).not.toContain("At home Original");
  });

  it("follows a change the player makes", async () => {
    const view = await mountWithMock(<DeviceSection />);
    cleanup = view.cleanup;
    await view.waitFor(() => expect(quality()).not.toBeNull());
    savePrefs({ quality: "4000" });
    await view.waitFor(() => expect(selectedText(quality())).toMatch(/^Medium/u));
  });
});

const conversions = () => selectTrigger(document, "Simultaneous picture conversions");

describe("Default quality", () => {
  it("names the server's choices as automatic and points to this device's own", async () => {
    const view = await mountWithMock(<PlaybackSection />);
    cleanup = view.cleanup;
    await view.waitFor(() => expect(selectTrigger(document, "At home")?.disabled).toBe(false));
    expect(view.text()).toContain("Default quality");
    expect(view.text()).toContain("Each device can choose its own quality under This device.");
    expect(document.querySelector('a[href="/settings/device"]')?.textContent).toBe(
      "Quality on this device",
    );
    expect(view.text()).not.toContain("Follows the server’s default");
  });

  it("limits simultaneous picture conversions: no limit first, then automatic and 1 to 10", async () => {
    const view = await mountWithMock(<PlaybackSection />);
    cleanup = view.cleanup;
    await view.waitFor(() => expect(conversions()?.disabled).toBe(false));
    expect(selectedText(conversions())).toBe("No limit");
    expect(await optionLabels(conversions())).toEqual([
      "No limit",
      "Automatic",
      ...Array.from({ length: 10 }, (_, index) => String(index + 1)),
    ]);
    await pickOption(conversions(), "2");
    await view.settle(autosaveDelay + 200);
    await view.waitFor(() =>
      expect(view.server.data.playbackSettings.pictureConversions).toBe("2"),
    );
  });
});

const props = (arg: string): OverlayComponentProps => ({
  open: true,
  overlay: { kind: "dlg", name: "pin", arg },
  onOpenChange: () => {},
});

describe("Switching profile", () => {
  it("asks for Kim's PIN, says when it is wrong, and switches with the right one", async () => {
    const view = await mountWithMock(<PinDialog {...props("kim")} />);
    cleanup = view.cleanup;
    await view.waitFor(() => expect(view.text()).toContain("Switch to Kim"));
    const input = document.querySelector<HTMLInputElement>('input[inputmode="numeric"]');
    if (input === null) throw new Error("no PIN input");
    const type = async (value: string) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await view.settle(60);
    };
    await type("0000");
    await view.waitFor(() => expect(view.text()).toContain("That PIN isn't right."));
    await type(mockPin);
    await view.waitFor(() =>
      expect(view.client.getQueryData(["auth", "me"])).toMatchObject({
        displayName: "Kim",
      }),
    );
  });
});
