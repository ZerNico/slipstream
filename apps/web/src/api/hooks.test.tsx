// @vitest-environment happy-dom
import { useQuery } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { DAY, RecordingId, RuleId } from "@slipstream/domain";
import { renderWithApi, type Rendered } from "~/test/render.tsx";
import { clientsLayer, makeApi } from "./client.ts";
import {
  useGuideRepeats,
  useQueries,
  useRuleHistory,
  useRuleOffer,
  useServerEvents,
} from "./hooks.ts";
import { useCreateRecording } from "./mutations.ts";
import { mockOrigin } from "./mock/household.ts";

let rendered: Rendered | undefined;
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
});

/** Shows the live-events status and the race's state, as the shell and library would. */
function RaceState() {
  const status = useServerEvents();
  const queries = useQueries();
  const recordings = useQuery(queries.recordings());
  const race = recordings.data?.find((entry) => entry.id === "rennen-las-vegas");
  return (
    <p>
      <span data-testid="status">{status}</span>
      <span data-testid="state">{race?.state ?? "loading"}</span>
    </p>
  );
}

describe("data hooks against the mock server", () => {
  it("loads through the typed client and applies live events to what is on screen", async () => {
    rendered = await renderWithApi(<RaceState />);
    const { host, server, waitFor } = rendered;
    const read = (id: string) => host.querySelector(`[data-testid="${id}"]`)?.textContent;
    await waitFor(() => expect(read("state")).toBe("recording"));
    await waitFor(() => expect(read("status")).toBe("open"));

    server.data.recordings = server.data.recordings.map((entry) =>
      entry.id === "rennen-las-vegas" ? { ...entry, state: "completed" } : entry,
    );
    server.publish({
      _tag: "RecordingChanged",
      recordingId: RecordingId.make("rennen-las-vegas"),
      state: "completed",
    });
    await waitFor(() => expect(read("state")).toBe("completed"));
  });

  it("drops a recording another device deleted from what is on screen", async () => {
    rendered = await renderWithApi(<RaceState />);
    const { host, server, waitFor } = rendered;
    const read = (id: string) => host.querySelector(`[data-testid="${id}"]`)?.textContent;
    await waitFor(() => expect(read("state")).toBe("recording"));
    await waitFor(() => expect(read("status")).toBe("open"));

    // A second sign-in on the same server, as another device or a co-owner would be.
    const other = makeApi(
      clientsLayer({
        baseUrl: mockOrigin,
        fetch: (input, init) => server.handler(new Request(input, init)),
      }),
    );
    try {
      await other.call((c) =>
        c.recordings.remove({
          params: { recordingId: RecordingId.make("rennen-las-vegas") },
          query: {},
        }),
      );
    } finally {
      await other.dispose();
    }
    await waitFor(() => expect(read("state")).toBe("loading"));
  });

  it("invalidates the recordings list after scheduling a programme", async () => {
    function Record() {
      const queries = useQueries();
      const recordings = useQuery(queries.recordings());
      const create = useCreateRecording();
      const tagesthemen = "das-erste";
      return (
        <div>
          <span data-testid="count">{recordings.data?.length ?? "-"}</span>
          <button
            type="button"
            onClick={() => {
              const programme = rendered?.server.data.programmes.find(
                (candidate) =>
                  candidate.channelId === tagesthemen && candidate.title === "Tagesthemen",
              );
              if (programme) create.mutate({ _tag: "Programme", programmeId: programme.id });
            }}
          >
            record
          </button>
        </div>
      );
    }
    rendered = await renderWithApi(<Record />);
    const { host, waitFor, click, server } = rendered;
    const count = () => host.querySelector('[data-testid="count"]')?.textContent;
    // The list leaves hidden recordings out (a replaced original, a chain's anchor).
    const before = server.data.recordings.filter((entry) => entry.hiddenAt === undefined).length;
    await waitFor(() => expect(count()).toBe(String(before)));
    await click(host.querySelector("button"));
    await waitFor(() => expect(count()).toBe(String(before + 1)));
  });

  it("reads the series offer, history and the guide's repeats", async () => {
    const academy = RuleId.make("live-f1-academy");
    const tatort = RuleId.make("tatort");
    const range = { from: Date.now(), to: Date.now() + 2 * DAY };
    function Series({ ruleId }: { readonly ruleId: RuleId | undefined }) {
      const offer = useRuleOffer(ruleId);
      const history = useRuleHistory(tatort);
      const repeats = useGuideRepeats(range);
      return (
        <p>
          <span data-testid="offer">{offer.data?.offer?.groups ?? "none"}</span>
          <span data-testid="history">{history.data?.count ?? "loading"}</span>
          <span data-testid="repeats">{repeats.data?.length ?? "loading"}</span>
        </p>
      );
    }
    rendered = await renderWithApi(<Series ruleId={academy} />);
    const { host, waitFor } = rendered;
    const read = (id: string) => host.querySelector(`[data-testid="${id}"]`)?.textContent;
    await waitFor(() => expect(read("offer")).toBe("3"));
    // Alex sees none of Kim's deleted episodes.
    await waitFor(() => expect(read("history")).toBe("0"));
    await waitFor(() => expect(Number(read("repeats"))).toBeGreaterThan(0));
    await rendered.unmount();
    // Without a rule nothing is asked.
    rendered = await renderWithApi(<Series ruleId={undefined} />);
    const later = rendered;
    await later.waitFor(() =>
      expect(later.host.querySelector('[data-testid="offer"]')?.textContent).toBe("none"),
    );
  });
});
