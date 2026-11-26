/**
 * Sample programmes for the kitchen sink: realistic guide data (titles are data, like the API's,
 * not interface copy). Times are relative to the moment the page renders.
 */
import type { ArtworkSubject } from "~/ui/artwork/generate.ts";
import type { TimelineData } from "@slipstream/domain";
import { MINUTE } from "@slipstream/domain";

/** One programme per artwork genre, with its channel. */
export const sampleArtwork: readonly ArtworkSubject[] = [
  {
    title: "Live F1: Qualifying - GP Katar",
    categories: ["Sport"],
    channel: { mark: "F1" },
  },
  {
    title: "Live F1: Rennen - GP Katar",
    categories: ["Motorsport"],
    channel: { mark: "F1" },
  },
  {
    title: "Tatort: Borowski und der Schatten des Mondes",
    categories: ["Krimi"],
    channel: { mark: "ARD" },
  },
  { title: "Der Pate", categories: ["Spielfilm"], channel: { mark: "arte" } },
  { title: "Tagesschau", categories: ["Nachrichten"], channel: { mark: "ARD" } },
  {
    title: "Terra X: Faszination Erde",
    categories: ["Dokumentation"],
    channel: { mark: "ZDF" },
  },
  {
    title: "Die Sendung mit der Maus",
    categories: ["Kinder"],
    channel: { mark: "KiKA" },
  },
  {
    title: "Wer weiß denn sowas?",
    categories: ["Show"],
    channel: { mark: "ARD" },
  },
];

/** Timelines in the states SPEC §5 draws, around `now`. */
export const sampleTimelines = (now: number): Record<string, TimelineData> => {
  const start = now - 47 * MINUTE;
  return {
    behind: {
      start,
      end: start + 155 * MINUTE,
      captured: { start, end: now },
      playhead: now - 31.5 * MINUTE,
      live: now,
      marks: [start + 5 * MINUTE, start + 95 * MINUTE],
      gaps: [{ start: start + 20 * MINUTE, end: start + 22 * MINUTE }],
      bands: [
        { start, end: start + 5 * MINUTE, title: "Vorberichte" },
        { start: start + 5 * MINUTE, end: start + 95 * MINUTE, title: "Qualifying" },
        { start: start + 95 * MINUTE, end: start + 155 * MINUTE, title: "Pressekonferenz" },
      ],
    },
    live: { start, end: start + 155 * MINUTE, captured: { start, end: now }, live: now },
    resumeNearStart: {
      start,
      end: start + 155 * MINUTE,
      captured: { start, end: now },
      playhead: start + 4 * MINUTE,
      live: now,
    },
    finished: {
      start: now - 120 * MINUTE,
      end: now - 45 * MINUTE,
      captured: { start: now - 120 * MINUTE, end: now - 45 * MINUTE },
      playhead: now - 120 * MINUTE + 46.5 * MINUTE,
    },
    startsSoon: {
      start: now - 12 * MINUTE,
      end: now + 108 * MINUTE,
      now,
      bands: [
        { start: now - 12 * MINUTE, end: now + 43 * MINUTE, title: "Sportschau" },
        { start: now + 43 * MINUTE, end: now + 108 * MINUTE, title: "Live F1: Rennen" },
      ],
    },
  };
};
