/**
 * Incremental parser for `text/event-stream` (the WHATWG server-sent events format). React
 * Native's fetch cannot stream a response body, so the app reads the stream through
 * XMLHttpRequest progress events and feeds each new chunk here.
 */

/**
 * One dispatched event. `event` is "message" when the server named none. The server sends
 * neither `id:` nor `retry:` (the app reconnects on its own schedule and every reconnect
 * refetches what is live), so the parser skips both fields.
 */
export interface SseMessage {
  readonly event: string;
  readonly data: string;
}

/** What the parser carries between chunks: an unfinished line and the event being built. */
export interface SseState {
  readonly pending: string;
  readonly event: string;
  readonly data: readonly string[];
}

/** The parser before the first chunk. */
export const initialSse: SseState = { pending: "", event: "", data: [] };

const fieldOf = (line: string): readonly [string, string] => {
  const colon = line.indexOf(":");
  if (colon === -1) return [line, ""];
  const value = line.slice(colon + 1);
  return [line.slice(0, colon), value.startsWith(" ") ? value.slice(1) : value];
};

/**
 * Feeds one chunk. Returns the next state and the events completed by a blank line in this
 * chunk. Lines may end in CRLF, LF or CR; comment lines (`: keep-alive`) are ignored.
 */
export const feedSse = (
  state: SseState,
  chunk: string,
): { readonly state: SseState; readonly messages: readonly SseMessage[] } => {
  const text = state.pending + chunk;
  const lines = text.split(/\r\n|\n|\r/u);
  // A trailing CR might be the first half of a CRLF split across chunks; keep it pending.
  const pending = text.endsWith("\r") ? `${lines.at(-2) ?? ""}\r` : (lines.at(-1) ?? "");
  const complete = text.endsWith("\r") ? lines.slice(0, -2) : lines.slice(0, -1);
  let { event, data } = state;
  const messages: SseMessage[] = [];
  for (const line of complete) {
    if (line === "") {
      if (data.length > 0) messages.push({ event: event || "message", data: data.join("\n") });
      event = "";
      data = [];
      continue;
    }
    if (line.startsWith(":")) continue;
    const [field, value] = fieldOf(line);
    if (field === "event") event = value;
    else if (field === "data") data = [...data, value];
  }
  return { state: { pending, event, data }, messages };
};
