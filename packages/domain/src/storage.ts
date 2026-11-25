/*
 * A disk as the storage meters draw it (Settings › Storage on every client), so bar, legend and
 * heading add up the same way everywhere.
 */

/** What a meter needs of a disk: its size, what is free, and Slipstream's own parts. */
export interface StorageNumbers {
  readonly totalBytes: number;
  readonly freeBytes: number;
  readonly recordingsBytes: number;
  /** Live TV kept for pause and rewind. */
  readonly bufferBytes: number;
}

/** A disk's used space, split so its pieces add up. */
export interface StorageParts {
  /** Everything taken on the disk: total minus free. */
  readonly used: number;
  readonly recordings: number;
  /** Live TV kept for pause and rewind. */
  readonly buffer: number;
  /** Whatever else fills the disk (other programs, the system): used minus Slipstream's own. */
  readonly other: number;
}

/**
 * Splits a disk's used space into recordings, pause-and-rewind and other files, so a meter's
 * bar, its legend and its "used of total" heading add up. Numbers that disagree (a scan racing a
 * write) never make a part negative.
 */
export const storageParts = (storage: StorageNumbers): StorageParts => {
  const used = Math.max(0, storage.totalBytes - storage.freeBytes);
  const recordings = Math.max(0, storage.recordingsBytes);
  const buffer = Math.max(0, storage.bufferBytes);
  return { used, recordings, buffer, other: Math.max(0, used - recordings - buffer) };
};

/**
 * A part's share of the whole disk, from 0 to 1, for a meter segment's width. An empty disk
 * counts as one byte, so nothing divides by zero.
 */
export const storageShare = (bytes: number, totalBytes: number): number =>
  Math.min(1, Math.max(0, bytes / Math.max(1, totalBytes)));
