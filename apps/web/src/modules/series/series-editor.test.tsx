// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelId, type ExtraTimeDefaults, RuleId } from "@slipstream/domain";
import type { MockData } from "~/api/mock/fixtures.ts";
import { type Rendered, renderWithApi } from "~/test/render.tsx";
import { pickOption, selectedText, selectTrigger } from "~/test/select.ts";
import { toastManager } from "~/ui/toast-manager.ts";
import { SeriesEditorPage } from "./series-editor.tsx";

const skyF1 = ChannelId.make("sky-sport-f1");

/** Settings › Recording on the server these tests run against. */
const defaults: ExtraTimeDefaults = {
  padding: { beforeMinutes: 2, afterMinutes: 10 },
  overrides: [
    { _tag: "Category", category: "Sport", padding: { beforeMinutes: 5, afterMinutes: 45 } },
    { _tag: "Channel", channelId: skyF1, padding: { beforeMinutes: 5, afterMinutes: 60 } },
  ],
};

let view: Rendered | undefined;
let shown: string[] = [];
let stopToasts: (() => void) | undefined;
beforeEach(() => {
  shown = [];
  const add = toastManager.add.bind(toastManager);
  const spy = vi.spyOn(toastManager, "add").mockImplementation((options) => {
    for (const text of [options.title, options.description]) {
      if (typeof text === "string") shown.push(text);
    }
    return add(options);
  });
  stopToasts = () => spy.mockRestore();
});
afterEach(async () => {
  stopToasts?.();
  await view?.unmount();
  view = undefined;
});

/** The titles and descriptions of the toasts shown so far. */
const toasts = () => shown;

/**
 * Renders against a fresh mock; `setup` changes its data, after which every read is asked again,
 * as if the page had opened on that data.
 */
const render = async (ui: React.ReactNode, setup?: (data: MockData) => void) => {
  view = await renderWithApi(ui, { extraTime: defaults });
  if (setup !== undefined) {
    setup(view.server.data);
    const { client } = view;
    await act(async () => {
      await client.invalidateQueries();
    });
  }
  return view;
};

/** The Formel 1 collection follows the Formel 1 live series recording. */
const linkFormel1 = (data: MockData) => {
  data.collections = data.collections.map((collection) =>
    collection.id === "formel-1"
      ? {
          ...collection,
          follows: { ruleId: RuleId.make("formel-1-live"), ruleName: "Formel 1 live" },
        }
      : collection,
  );
};

const buttonNamed = (root: ParentNode, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
const lastButtonNamed = (root: ParentNode, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].findLast(
    (candidate) => candidate.textContent?.trim() === text,
  );
const radio = (root: ParentNode, label: string) =>
  [...root.querySelectorAll("label")]
    .find((candidate) => candidate.textContent?.startsWith(label))
    ?.querySelector<HTMLInputElement>('input[type="radio"]');
/** The form's headings; a folded part's heading without the summary beside its title. */
const sectionTitles = (host: HTMLElement) =>
  [...host.querySelectorAll(".panel:not(aside) h2")].map((heading) =>
    ((heading.querySelector("button > span:first-child") ?? heading).textContent ?? "").replace(
      /^\d+/u,
      "",
    ),
  );
const collectionSelect = (host: HTMLElement) => selectTrigger(host, "#rule-collection");
const selected = (host: HTMLElement) => selectedText(collectionSelect(host));
const type = async (input: HTMLInputElement | null, value: string) => {
  await act(async () => {
    // React tracks the value it set; the prototype's setter makes this a real edit.
    Reflect.set(HTMLInputElement.prototype, "value", value, input!);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

/** The extra time the editor shows: Start early and End late, in minutes. */
const extraTime = (host: HTMLElement) =>
  ["Start early", "End late"].map(
    (label) => /\d+/u.exec(selectedText(selectTrigger(host, label)) ?? "")?.[0],
  );

describe("the series recording editor", () => {
  it("starts from the matching default, and Reset goes back to it", async () => {
    const { host, waitFor, click } = await render(
      <SeriesEditorPage seed={{ title: "Live F1:", channel: skyF1 }} />,
    );
    await waitFor(() => expect(extraTime(host)).toEqual(["5", "60"]));
    expect(host.textContent).not.toContain("default");
    await pickOption(selectTrigger(host, "End late"), "90 min");
    expect(extraTime(host)).toEqual(["5", "90"]);
    await click(buttonNamed(host, "Reset"));
    expect(extraTime(host)).toEqual(["5", "60"]);
  });

  it("previews what the draft records and names the automatic destination", async () => {
    const { host, waitFor } = await render(
      <SeriesEditorPage seed={{ title: "Live F1:", channel: skyF1 }} />,
    );
    await waitFor(() =>
      expect(host.textContent).toContain("Live F1: 1. Freies Training - GP Katar"),
    );
    await waitFor(() => expect(host.textContent).toContain("Automatic (Formel 1)"));
    expect(host.querySelector("#rule-preview mark")?.textContent).toBe("Live F1:");
  });

  it("creates the series recording with the default extra time it showed", async () => {
    const { host, waitFor, click, server } = await render(
      <SeriesEditorPage seed={{ title: "Live F1:", channel: skyF1 }} />,
    );
    await waitFor(() => expect(extraTime(host)).toEqual(["5", "60"]));
    await waitFor(() => expect(host.querySelector("[aria-busy]")).toBeNull());
    const name = host.querySelector<HTMLInputElement>("#rule-name")!;
    await act(async () => {
      // React tracks the value it set; the prototype's setter makes this a real edit.
      Reflect.set(HTMLInputElement.prototype, "value", "Alle F1-Sessions", name);
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click([...host.querySelectorAll("button")].find((b) => b.textContent === "Create"));
    await waitFor(() =>
      expect(server.data.rules.find((rule) => rule.name === "Alle F1-Sessions")?.padding).toEqual({
        beforeMinutes: 5,
        afterMinutes: 60,
      }),
    );
  });

  it("refuses a nameless series recording and says why", async () => {
    const { host, waitFor, click } = await render(
      <SeriesEditorPage seed={{ channel: ChannelId.make("arte") }} />,
    );
    await waitFor(() => expect(extraTime(host)).toEqual(["2", "10"]));
    await waitFor(() => expect(host.querySelector("[aria-busy]")).toBeNull());
    await click([...host.querySelectorAll("button")].find((b) => b.textContent === "Create"));
    expect(host.textContent).toContain("Give the series recording a name.");
    expect(document.activeElement?.id).toBe("rule-name");
  });

  it("opens New collection inline with the name selected, and Esc cancels only the step", async () => {
    const { host, waitFor } = await render(
      <SeriesEditorPage seed={{ title: "Live F1:", channel: skyF1 }} />,
    );
    await waitFor(() => expect(host.querySelector("[aria-busy]")).toBeNull());
    await waitFor(() => expect(selected(host)).toMatch(/^Automatic/u));
    await pickOption(collectionSelect(host), "New collection…");
    const input = host.querySelector<HTMLInputElement>("#rule-new-collection")!;
    expect(input.value).toBe("Live F1");
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(host.querySelector("#rule-new-collection")).toBeNull();
    expect(document.activeElement).toBe(collectionSelect(host));
    expect(selected(host)).toMatch(/^Automatic/u);
  });

  it("shows another person's series recording read-only to a non-admin", async () => {
    const rendered = await render(<SeriesEditorPage ruleId={"tatort" as never} />);
    const { host, waitFor, server, client } = rendered;
    // Alex is no admin here, and the Tatort series recording is Kim's.
    server.data.users = server.data.users.map((user) =>
      user.displayName === "Alex" ? { ...user, role: "user" } : user,
    );
    await act(async () => {
      await client.invalidateQueries();
    });
    await waitFor(() => expect(host.textContent).toContain("Kim's series recording, read-only."));
    expect(host.querySelector("fieldset")?.disabled).toBe(true);
  });

  it("says New series recording and Edit series recording, and Conditions", async () => {
    const { host, waitFor } = await render(<SeriesEditorPage seed={{ title: "Live F1:" }} />);
    await waitFor(() => expect(host.querySelector("[aria-busy]")).toBeNull());
    expect(host.querySelector("h1")?.textContent).toBe("New series recording");
    expect(sectionTitles(host)).toEqual([
      "Name & channels",
      "Conditions",
      "When",
      "Options",
      "Extra time",
      "Episodes",
      "Goes to",
    ]);
    expect(host.textContent).not.toMatch(/\brules?\b/iu);
    await view?.unmount();
    const edit = await render(<SeriesEditorPage ruleId={RuleId.make("tatort")} />);
    await edit.waitFor(() => expect(edit.host.querySelector("[aria-busy]")).toBeNull());
    expect(edit.host.querySelector("h1")?.textContent).toBe("Edit series recording");
  });
});

describe("the Episodes section", () => {
  it("starts on new episodes only", async () => {
    const { host, waitFor } = await render(
      <SeriesEditorPage seed={{ title: "Live F1:", channel: skyF1 }} />,
    );
    await waitFor(() => expect(host.querySelector("[aria-busy]")).toBeNull());
    expect(radio(host, "New episodes only")?.checked).toBe(true);
    expect(radio(host, "All airings")?.checked).toBe(false);
  });

  it("saves All airings as skipRepeats false", async () => {
    const { host, waitFor, click, server } = await render(
      <SeriesEditorPage ruleId={RuleId.make("tatort")} />,
    );
    await waitFor(() => expect(host.querySelector("[aria-busy]")).toBeNull());
    await click(radio(host, "All airings"));
    expect(radio(host, "All airings")?.checked).toBe(true);
    await click(buttonNamed(host, "Save"));
    await waitFor(() =>
      expect(server.data.rules.find((rule) => rule.id === "tatort")?.skipRepeats).toBe(false),
    );
  });

  it("leaves the choice out of the PATCH when it was not touched", async () => {
    const { host, waitFor, click, server } = await render(
      <SeriesEditorPage ruleId={RuleId.make("tatort")} />,
    );
    await waitFor(() => expect(host.querySelector("[aria-busy]")).toBeNull());
    // Another client switched it meanwhile; renaming here must not switch it back.
    server.data.rules = server.data.rules.map((rule) =>
      rule.id === "tatort" ? { ...rule, skipRepeats: false } : rule,
    );
    await type(host.querySelector<HTMLInputElement>("#rule-name"), "Tatort am Sonntag");
    await click(buttonNamed(host, "Save"));
    await waitFor(() =>
      expect(server.data.rules.find((rule) => rule.id === "tatort")?.name).toBe(
        "Tatort am Sonntag",
      ),
    );
    expect(server.data.rules.find((rule) => rule.id === "tatort")?.skipRepeats).toBe(false);
  });

  it("counts the deleted episodes it keeps out and forgets them after a confirm", async () => {
    const { host, waitFor, click, server } = await render(
      <SeriesEditorPage ruleId={RuleId.make("tatort")} />,
      (data) => {
        // Alex deleted three Tatort episodes.
        const alex = data.users.find((user) => user.displayName === "Alex")!;
        data.history = data.history.map((row) => ({ ...row, userId: alex.id }));
      },
    );
    await waitFor(() =>
      expect(host.querySelector("[data-history]")?.textContent).toContain(
        "3 deleted episodes won't be recorded again",
      ),
    );
    await click(buttonNamed(host, "Forget them"));
    expect(host.querySelector("[data-history]")?.textContent).toContain(
      "Record them again when they're repeated?",
    );
    expect(server.data.history).toHaveLength(3);
    await click(buttonNamed(host, "Forget them"));
    await waitFor(() => expect(host.querySelector("[data-history]")).toBeNull());
    expect(server.data.history).toEqual([]);
    expect(toasts()).toContain("Deleted episodes will be recorded again when they're repeated");
  });

  it("has no history line when nothing is kept out", async () => {
    const { host, waitFor } = await render(<SeriesEditorPage ruleId={RuleId.make("tatort")} />);
    await waitFor(() => expect(host.querySelector("[aria-busy]")).toBeNull());
    expect(host.querySelector("[data-history]")).toBeNull();
  });
});

describe("Goes to and the collection that follows", () => {
  it("says where Automatic scatters and groups them in a collection that follows", async () => {
    const { host, waitFor, click, server } = await render(
      <SeriesEditorPage ruleId={RuleId.make("live-f1-academy")} />,
    );
    await waitFor(() =>
      expect(selected(host)).toMatch(/^Automatic \(by title and date, \d+ separate places\)$/u),
    );
    await click(buttonNamed(host, "Group them in a collection"));
    const name = host.querySelector<HTMLInputElement>("#rule-new-collection")!;
    expect(name.value).toBe("Live F1 Academy");
    expect(document.activeElement).toBe(name);
    await click(buttonNamed(host, "Group them"));
    await waitFor(() =>
      expect(
        server.data.collections.find(
          (collection) => collection.follows?.ruleId === "live-f1-academy",
        )?.name,
      ).toBe("Live F1 Academy"),
    );
    await waitFor(() =>
      expect(selected(host)).toBe("Live F1 Academy (follows this series recording)"),
    );
    // Saved already: nothing left to save.
    expect(host.querySelector("[data-save-bar]")?.textContent).not.toContain("not saved yet");
  });

  it("names the linked collection and lets Goes to leave it", async () => {
    const { host, waitFor } = await render(
      <SeriesEditorPage ruleId={RuleId.make("formel-1-live")} />,
      linkFormel1,
    );
    await waitFor(() => expect(selected(host)).toBe("Formel 1 (follows this series recording)"));
    await pickOption(collectionSelect(host), "Automatic (Formel 1)");
    expect(selected(host)).toBe("Automatic (Formel 1)");
  });

  it("tells an owner who may not change collections that saving conditions unlinks it", async () => {
    const { host, waitFor } = await render(
      <SeriesEditorPage ruleId={RuleId.make("formel-1-live")} />,
      (data) => {
        linkFormel1(data);
        data.users = data.users.map((user) =>
          user.displayName === "Alex" ? { ...user, role: "user" } : user,
        );
      },
    );
    await waitFor(() => expect(host.querySelector("[data-linked-notice]")).not.toBeNull());
    expect(host.querySelector("[data-linked-notice]")?.textContent).toBe(
      "Saving changes to the conditions stops “Formel 1” following this series recording. The collection keeps today's conditions.",
    );
    // The conditions stay editable.
    expect(host.querySelector("fieldset")?.disabled).toBe(false);
  });

  it("is not there without a following collection", async () => {
    const { host, waitFor } = await render(
      <SeriesEditorPage ruleId={RuleId.make("formel-1-live")} />,
    );
    await waitFor(() => expect(host.querySelector("[aria-busy]")).toBeNull());
    expect(host.querySelector("[data-linked-notice]")).toBeNull();
    expect(selected(host)).toBe("Formel 1");
  });
});

describe("deleting a series recording", () => {
  it("keeps a collection that follows it unless the box is ticked", async () => {
    const { host, waitFor, click, server } = await render(
      <SeriesEditorPage ruleId={RuleId.make("formel-1-live")} />,
      linkFormel1,
    );
    await waitFor(() => expect(selected(host)).toContain("follows this series recording"));
    await click(buttonNamed(host, "Delete"));
    await waitFor(() =>
      expect(document.body.textContent).toContain("Delete the series recording “Formel 1 live”?"),
    );
    const box = [...document.body.querySelectorAll<HTMLElement>("[role='checkbox']")].find(
      (element) =>
        element.closest("label")?.textContent === "Also remove the collection “Formel 1”",
    );
    expect(box?.getAttribute("aria-checked")).toBe("false");
    await click(box?.closest("label"));
    await waitFor(() => expect(box?.getAttribute("aria-checked")).toBe("true"));
    // The dialog's, drawn last (the phone's Delete under the form says the same).
    await click(lastButtonNamed(document.body, "Delete series recording"));
    await waitFor(() =>
      expect(server.data.rules.find((rule) => rule.id === "formel-1-live")).toBeUndefined(),
    );
    expect(
      server.data.collections.find((collection) => collection.id === "formel-1"),
    ).toBeUndefined();
  });

  it("keeps the collection without asking for someone who may not change collections", async () => {
    const { host, waitFor, click, server } = await render(
      <SeriesEditorPage ruleId={RuleId.make("formel-1-live")} />,
      (data) => {
        linkFormel1(data);
        data.users = data.users.map((user) =>
          user.displayName === "Alex" ? { ...user, role: "user" } : user,
        );
      },
    );
    await waitFor(() => expect(host.querySelector("[data-linked-notice]")).not.toBeNull());
    await click(buttonNamed(host, "Delete"));
    expect(host.querySelector("[data-save-bar]")?.textContent).toContain(
      "Delete it? Recordings you have stay.",
    );
    // The save bar's, drawn after the phone's Delete under the form.
    await click(lastButtonNamed(host, "Delete series recording"));
    await waitFor(() =>
      expect(server.data.rules.find((rule) => rule.id === "formel-1-live")).toBeUndefined(),
    );
    const kept = server.data.collections.find((collection) => collection.id === "formel-1");
    expect(kept?.follows).toBeUndefined();
    expect(toasts()).toContain("The collection Formel 1 stays");
  });
});
