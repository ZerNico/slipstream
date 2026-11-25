// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { mount } from "~/test/dom.tsx";
import { RecordChip } from "./record-now.tsx";

let mounted: Awaited<ReturnType<typeof mount>> | undefined;
afterEach(async () => {
  await mounted?.unmount();
  mounted = undefined;
});

describe("RecordChip", () => {
  it("keeps its place when there is nothing to record, so the chips beside it hold still", async () => {
    mounted = await mount(<RecordChip control={undefined} />);
    const chip = mounted.host.querySelector("button");
    expect(chip).not.toBeNull();
    expect(chip?.className).toContain("invisible");
    expect(chip?.getAttribute("aria-hidden")).toBe("true");
    expect(chip?.tabIndex).toBe(-1);
    expect(chip?.hasAttribute("disabled")).toBe(true);
  });

  it("is the Record chip when it can record", async () => {
    mounted = await mount(
      <RecordChip
        control={{
          kind: "record",
          busy: false,
          onRecord: () => undefined,
          onOptions: () => undefined,
        }}
      />,
    );
    const chip = mounted.host.querySelector("button");
    expect(chip?.className).not.toContain("invisible");
    expect(chip?.hasAttribute("aria-hidden")).toBe(false);
  });
});
