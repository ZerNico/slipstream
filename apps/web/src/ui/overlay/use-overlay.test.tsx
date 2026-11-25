// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { mount } from "~/test/dom.tsx";
import { useOverlay } from "./use-overlay.tsx";

/** Buttons that drive the overlay hook the way sheets, menus and dialogs do. */
function Driver() {
  const overlay = useOverlay();
  return (
    <div>
      <output data-testid="current">
        {overlay.current ? `${overlay.current.kind}:${overlay.current.name}` : "none"}
      </output>
      <button
        type="button"
        data-testid="open-sheet"
        onClick={() => overlay.open({ kind: "sheet", name: "prog", arg: "7" })}
      />
      <button
        type="button"
        data-testid="open-dialog"
        onClick={() => overlay.open({ kind: "dlg", name: "cmdk" })}
      />
      <button type="button" data-testid="close" onClick={() => void overlay.close()} />
      <button type="button" data-testid="leave" onClick={() => overlay.leaveTo({ to: "/" })} />
    </div>
  );
}

let teardown: (() => Promise<void>) | undefined;
afterEach(async () => {
  await teardown?.();
  teardown = undefined;
});

const setup = async (url: string) => {
  const mounted = await mount(<Driver />, url);
  teardown = mounted.unmount;
  const get = (id: string) => mounted.host.querySelector(`[data-testid="${id}"]`);
  return { ...mounted, get, current: () => get("current")?.textContent };
};

describe("useOverlay: overlays live in the URL (SPEC §11)", () => {
  it("opening pushes one entry, so Back closes the overlay before leaving the page", async () => {
    const page = await setup("/guide?view=channels");
    await page.click(page.get("open-sheet"));
    expect(page.url()).toBe("/guide?view=channels&sheet=prog%3A7");
    expect(page.current()).toBe("sheet:prog");
    await page.back();
    expect(page.url()).toBe("/guide?view=channels");
    expect(page.current()).toBe("none");
  });

  it("an overlay opened from another replaces its entry: one Back lands on the page", async () => {
    const page = await setup("/guide");
    await page.click(page.get("open-sheet"));
    await page.click(page.get("open-dialog"));
    expect(page.current()).toBe("dlg:cmdk");
    await page.back();
    expect(page.url()).toBe("/guide");
  });

  it("closing a pushed overlay goes back through history", async () => {
    const page = await setup("/rules");
    await page.click(page.get("open-dialog"));
    await page.click(page.get("close"));
    await page.settle(50);
    expect(page.url()).toBe("/rules");
    expect(page.current()).toBe("none");
  });

  it("closing a deep-linked overlay replaces the entry instead of leaving the app", async () => {
    const page = await setup("/guide?sheet=prog:3");
    expect(page.current()).toBe("sheet:prog");
    await page.click(page.get("close"));
    expect(page.url()).toBe("/guide");
    expect(page.current()).toBe("none");
  });

  it("a link inside an overlay replaces the overlay's entry, so Back never reopens it", async () => {
    const page = await setup("/rules");
    await page.click(page.get("open-dialog"));
    await page.click(page.get("leave"));
    expect(page.url()).toBe("/");
    await page.back();
    expect(page.url()).not.toContain("dlg=");
  });
});
