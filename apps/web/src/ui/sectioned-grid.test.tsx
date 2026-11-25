// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { mount } from "~/test/dom.tsx";
import { type GridSection, SectionedGrid } from "./sectioned-grid.tsx";

let teardown: (() => Promise<void>) | undefined;
afterEach(async () => {
  await teardown?.();
  teardown = undefined;
});

/** `count` sections of `size` items, named by section and place. */
const sections = (count: number, size: number): readonly GridSection<string>[] =>
  Array.from({ length: count }, (_, section) => ({
    key: `s${section}`,
    title: `Section ${section}`,
    items: Array.from({ length: size }, (__, item) => `${section}-${item}`),
  }));

const setup = async (data: readonly GridSection<string>[]) => {
  const mounted = await mount(
    <SectionedGrid
      sections={data}
      grid="grid grid-cols-4"
      itemKey={(item) => item}
      renderItem={(item) => <span data-item={item}>{item}</span>}
    />,
    "/",
  );
  teardown = mounted.unmount;
  // The windowed grid's hidden measuring row is not one of the items.
  return () => mounted.host.querySelectorAll("[data-item]:not([inert] *)").length;
};

describe("SectionedGrid", () => {
  it("draws a short library whole, as plain sections", async () => {
    const items = await setup(sections(3, 10));
    expect(items()).toBe(30);
    expect(document.querySelectorAll("section.section")).toHaveLength(3);
  });

  it("draws only part of a long one", async () => {
    const items = await setup(sections(50, 40));
    expect(items()).toBeGreaterThan(0);
    expect(items()).toBeLessThan(2000);
  });
});
