import type { SseTransport } from "./events.ts";

/**
 * How much of one event stream request the transport reads before it ends it, in characters.
 * `responseText` keeps everything the request received, so a TV left on for days would hold an
 * ever longer string; ending the request hands it to the event stream's reconnect (as a normal
 * close), which starts a fresh one and refetches what is live.
 */
const STREAM_BUDGET = 1024 * 1024;

/**
 * Reads a response text that only grows: each call hands on the part not seen before, and says
 * once `budget` characters have arrived in all.
 */
export const growingText = (budget: number) => {
  let seen = 0;
  return (text: string): { readonly chunk: string | undefined; readonly spent: boolean } => {
    const chunk = text.length > seen ? text.slice(seen) : undefined;
    seen = Math.max(seen, text.length);
    return { chunk, spent: seen >= budget };
  };
};

/**
 * Server-sent events over XMLHttpRequest. React Native's fetch buffers the whole body, but its
 * XMLHttpRequest reports `responseText` incrementally while the request is open, which is all
 * an event stream needs. Only the new part of `responseText` is handed on each time, and the
 * request ends after {@link STREAM_BUDGET} characters so the text never grows without bound.
 */
export const xhrTransport: SseTransport = {
  open: (request, handlers) => {
    const xhr = new XMLHttpRequest();
    const read = growingText(STREAM_BUDGET);
    let finished = false;
    /** Hands on what is new; true when the budget is spent. */
    const flush = () => {
      const { chunk, spent } = read(xhr.responseText);
      if (chunk !== undefined) handlers.onChunk(chunk);
      return spent;
    };
    xhr.open("GET", request.url);
    for (const [name, value] of Object.entries(request.headers)) xhr.setRequestHeader(name, value);
    // Listening for progress turns on React Native's incremental `responseText` updates.
    xhr.addEventListener("progress", () => {
      if (finished || xhr.status < 200 || xhr.status >= 300 || !flush()) return;
      finished = true;
      xhr.abort();
      handlers.onClose();
    });
    xhr.addEventListener("readystatechange", () => {
      if (xhr.readyState !== XMLHttpRequest.DONE || finished) return;
      finished = true;
      if (xhr.status >= 200 && xhr.status < 300) {
        flush();
        handlers.onClose();
      } else {
        handlers.onError(xhr.status === 0 ? undefined : xhr.status);
      }
    });
    xhr.send();
    return () => {
      finished = true;
      xhr.abort();
    };
  },
};
