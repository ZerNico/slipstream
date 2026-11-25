/**
 * Child process supervision for the dev and e2e runners: prefixed, coloured output, and a stop
 * that leaves nothing behind. Every child runs in its own process group; stopping sends SIGTERM
 * to each group leader (so the server shuts its captures down in order), then SIGKILL to each
 * whole group, which takes any ffmpeg a leader left behind with it.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { styleText } from "node:util";
import { repoRoot } from "./dev-state.ts";

/** The colours children are tagged with. */
export type Colour = "magenta" | "cyan" | "green" | "yellow" | "blue";

const useColour = process.stdout.isTTY && process.env["NO_COLOR"] === undefined;

/** Styles text for the terminal, or leaves it plain when output is not a terminal. */
export const paint = (colour: Parameters<typeof styleText>[0], text: string): string =>
  useColour ? styleText(colour, text) : text;

/** A fixed-width coloured `[name]` tag. */
export const tag = (name: string, colour: Colour): string => paint(colour, `[${name}]`.padEnd(8));

/** Writes `prefix line` for every line a stream produces. */
export const prefixLines = (
  stream: NodeJS.ReadableStream,
  prefix: string,
  write: (line: string) => void,
): void => {
  createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY }).on("line", (line) =>
    write(`${prefix} ${line}`),
  );
};

const ignoreGone = (error: unknown): void => {
  if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
};

const exited = (child: ChildProcess): Promise<void> =>
  child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve()
    : new Promise((resolve) => child.once("exit", () => resolve()));

/** Starts children and stops all of them together. */
export class Supervisor {
  private readonly children = new Set<ChildProcess>();
  private readonly onExit: (name: string, reason: string) => void;
  /** Set once {@link stopAll} began; exits after that are expected. */
  stopping = false;

  /** How many children were started. */
  get size(): number {
    return this.children.size;
  }

  /** `onExit` hears about a child that ended (or failed to start) while not stopping. */
  constructor(onExit: (name: string, reason: string) => void) {
    this.onExit = onExit;
  }

  /** Starts a child in its own process group, its output prefixed with `[name]`. */
  start(
    name: string,
    colour: Colour,
    command: string,
    args: ReadonlyArray<string>,
    options: { readonly cwd?: string; readonly env?: Record<string, string> } = {},
  ): ChildProcess {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: { ...process.env, ...(useColour ? { FORCE_COLOR: "1" } : {}), ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    this.children.add(child);
    const prefix = tag(name, colour);
    if (child.stdout !== null) prefixLines(child.stdout, prefix, (line) => console.log(line));
    if (child.stderr !== null) prefixLines(child.stderr, prefix, (line) => console.error(line));
    child.once("error", (error) => {
      if (!this.stopping) this.onExit(name, `could not start: ${error.message}`);
    });
    child.once("exit", (code, signal) => {
      if (!this.stopping) this.onExit(name, `exited (${signal ?? `code ${code}`})`);
    });
    return child;
  }

  /** Stops every child, waiting up to `graceMs` for an orderly shutdown before killing. */
  async stopAll(graceMs = 8000): Promise<void> {
    this.stopping = true;
    const running = [...this.children];
    for (const child of running) {
      if (child.pid === undefined) continue;
      try {
        process.kill(child.pid, "SIGTERM");
      } catch (error) {
        ignoreGone(error);
      }
    }
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.all(running.map(exited)),
      new Promise((resolve) => {
        timer = setTimeout(resolve, graceMs);
      }),
    ]);
    clearTimeout(timer);
    for (const child of running) {
      if (child.pid === undefined) continue;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        ignoreGone(error);
      }
    }
  }
}

/** Whether a URL answers 2xx within a second. */
export const answers = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
};

/** Polls a URL until it answers 2xx; fails after `timeoutMs` or when `cancelled()` says so. */
export const waitFor = async (
  url: string,
  timeoutMs: number,
  cancelled: () => boolean = () => false,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!(await answers(url))) {
    if (cancelled()) throw new Error("stopped");
    if (Date.now() > deadline) throw new Error(`${url} did not answer within ${timeoutMs / 1000}s`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
};
