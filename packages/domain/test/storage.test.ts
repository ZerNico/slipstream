import { describe, expect, it } from "vitest";
import { storageParts, storageShare } from "../src/storage.ts";

const GB = 1e9;
const disk = {
  totalBytes: 2000 * GB,
  freeBytes: 620 * GB,
  recordingsBytes: 1160 * GB,
  bufferBytes: 180 * GB,
};

describe("storageParts", () => {
  it("splits the used space so recordings, pause and rewind and other files add up to it", () => {
    const parts = storageParts(disk);
    expect(parts).toEqual({
      used: 1380 * GB,
      recordings: 1160 * GB,
      buffer: 180 * GB,
      other: 40 * GB,
    });
    expect(parts.recordings + parts.buffer + parts.other).toBe(parts.used);
  });

  it("never makes a part negative when the numbers disagree", () => {
    expect(storageParts({ ...disk, freeBytes: 900 * GB }).other).toBe(0);
  });
});

describe("storageShare", () => {
  it("is the part's fraction of the disk, held between 0 and 1", () => {
    expect(storageShare(500 * GB, 2000 * GB)).toBe(0.25);
    expect(storageShare(3000 * GB, 2000 * GB)).toBe(1);
    expect(storageShare(-1, 2000 * GB)).toBe(0);
    expect(storageShare(0, 0)).toBe(0);
  });
});
