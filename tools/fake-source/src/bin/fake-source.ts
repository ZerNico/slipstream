#!/usr/bin/env node
import { parseArgs } from "node:util";
import { NodeRuntime } from "@effect/platform-node";
import { Layer } from "effect";
import { defaultSettings } from "../config.ts";
import { layer } from "../server.ts";

const usage = `Usage: fake-source [options]

  --port <n>            port to listen on (default 8090, 0 for any free port)
  --host <addr>         address to bind (default 127.0.0.1; 0.0.0.0 for the LAN)
  --tz <zone>           schedule and clock time zone (default ${defaultSettings.timeZone})
  --hours <n>           hours of guide data (default ${defaultSettings.guideHours})
  --duplicates          write every guide programme twice, like tvproxy
  --ffmpeg <path>       ffmpeg binary (default: ffmpeg on PATH)
  --font <path>         font file for the overlay (default: found automatically)
  --max-streams <n>     concurrent stream limit (default unlimited)
  --limit-status <n>    status sent past the limit (default 509)
  -h, --help            show this help
`;

/** Parses a numeric flag, exiting with the usage text when it isn't a number. */
const numberFlag = (name: string, value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    process.stderr.write(`--${name} needs a number, got "${value}"\n\n${usage}`);
    process.exit(2);
  }
  return parsed;
};

const { values } = parseArgs({
  options: {
    port: { type: "string" },
    host: { type: "string" },
    tz: { type: "string" },
    hours: { type: "string" },
    duplicates: { type: "boolean" },
    ffmpeg: { type: "string" },
    font: { type: "string" },
    "max-streams": { type: "string" },
    "limit-status": { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  process.stdout.write(usage);
} else {
  const maxStreams = numberFlag("max-streams", values["max-streams"]);
  const limitStatus = numberFlag("limit-status", values["limit-status"]);
  Layer.launch(
    layer({
      port: numberFlag("port", values.port) ?? 8090,
      host: values.host,
      timeZone: values.tz,
      guideHours: numberFlag("hours", values.hours),
      duplicateProgrammes: values.duplicates,
      ffmpegPath: values.ffmpeg,
      fontFile: values.font,
      faults: {
        ...(maxStreams === undefined ? {} : { maxStreams }),
        ...(limitStatus === undefined ? {} : { limitStatus }),
      },
      verbose: true,
    }),
  ).pipe(NodeRuntime.runMain);
}
