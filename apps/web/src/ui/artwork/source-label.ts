import { formatClock } from "~/i18n/formats.ts";
import { m } from "@slipstream/i18n";
import type { ArtworkSource } from "./generate.ts";

/** The words a source badge says: "Image from the guide", "Frame from the recording · 18:10". */
export const sourceLabel = (source: ArtworkSource): string => {
  switch (source.kind) {
    case "guide":
      return m.artwork_source_guide();
    case "online":
      return m.artwork_source_online();
    case "frame":
      return source.grabbedAt === undefined
        ? m.artwork_source_frame()
        : m.artwork_source_frame_at({ clock: formatClock(source.grabbedAt) });
    case "generated":
      return m.artwork_source_generated();
  }
};
