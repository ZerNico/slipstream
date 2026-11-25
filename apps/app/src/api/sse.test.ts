import { describe, expect, it } from "vitest";
import { feedSse, initialSse, type SseMessage, type SseState } from "./sse.ts";

/** Feeds chunks in order and collects every message. */
const feedAll = (chunks: readonly string[]) => {
  let state: SseState = initialSse;
  const messages: SseMessage[] = [];
  for (const chunk of chunks) {
    const result = feedSse(state, chunk);
    state = result.state;
    messages.push(...result.messages);
  }
  return { state, messages };
};

describe("feedSse", () => {
  it("dispatches an event at the blank line", () => {
    const { messages } = feedAll(['data: {"a":1}\n\n']);
    expect(messages).toEqual([{ event: "message", data: '{"a":1}' }]);
  });

  it("joins events split anywhere across chunks", () => {
    const { messages } = feedAll(["da", "ta: one\nda", "ta: two\n", "\nevent: x\ndata: 3\n\n"]);
    expect(messages).toEqual([
      { event: "message", data: "one\ntwo" },
      { event: "x", data: "3" },
    ]);
  });

  it("accepts CRLF, LF and CR line ends, including a CRLF split across chunks", () => {
    const { messages } = feedAll(["data: a\r", "\n\r\ndata: b\r\rdata: c\n\n"]);
    expect(messages.map((message) => message.data)).toEqual(["a", "b", "c"]);
  });

  it("ignores comments and keep-alives, and blank lines without data", () => {
    const { messages } = feedAll([": keep-alive\n\n", "\n\n", "data: x\n\n"]);
    expect(messages.map((message) => message.data)).toEqual(["x"]);
  });

  it("skips id and retry fields", () => {
    const { messages } = feedAll(["id: 7\nretry: 2500\ndata: a\n\n"]);
    expect(messages).toEqual([{ event: "message", data: "a" }]);
  });

  it("keeps an unfinished event until its blank line arrives", () => {
    const first = feedSse(initialSse, "data: half");
    expect(first.messages).toEqual([]);
    expect(feedSse(first.state, "\n\n").messages[0]?.data).toBe("half");
  });
});
