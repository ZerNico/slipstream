import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { CurrentUser, SlipstreamApi } from "@slipstream/api";
import { epochMs, overlaps, toGuideEntry } from "@slipstream/domain";
import { type MockContext, notFound } from "./context.ts";
import { repeatsFor } from "./series.ts";

/**
 * The mock's `guide` group: programmes in a window, now and next.
 * The shared state is in context.ts.
 */
export const guideGroup = (ctx: MockContext) => {
  const { data } = ctx;
  return HttpApiBuilder.group(SlipstreamApi, "guide", (handlers) =>
    handlers
      .handle("window", ({ query }) =>
        Effect.sync(() => {
          const wanted = query.channels?.split(",");
          return data.programmes
            .filter(
              (p) =>
                (wanted === undefined || wanted.includes(p.channelId)) &&
                overlaps(p, { start: query.from, end: query.to }),
            )
            .map(toGuideEntry);
        }),
      )
      .handle("extent", () =>
        Effect.sync(() => {
          const visible = new Set(data.channels.filter((c) => !c.hidden).map((c) => c.id));
          const last = data.programmes
            .filter((p) => visible.has(p.channelId))
            .reduce<(typeof data.programmes)[number] | undefined>(
              (latest, p) =>
                latest === undefined || epochMs(p.end) > epochMs(latest.end) ? p : latest,
              undefined,
            );
          return last === undefined ? {} : { end: last.end };
        }),
      )
      .handle("nowNext", () =>
        Effect.sync(() => {
          const at = Date.now();
          return data.channels
            .filter((c) => !c.hidden)
            .map((c) => {
              const own = data.programmes
                .filter((p) => p.channelId === c.id && epochMs(p.end) > at)
                .toSorted((a, b) => epochMs(a.start) - epochMs(b.start));
              const [first, second] = own;
              const airing = first !== undefined && epochMs(first.start) <= at;
              const current = airing ? first : undefined;
              const next = airing ? second : first;
              return {
                channelId: c.id,
                ...(current ? { now: current } : {}),
                ...(next ? { next } : {}),
              };
            });
        }),
      )
      .handle("search", ({ query }) =>
        Effect.sync(() =>
          data.programmes.filter((p) => p.title.toLowerCase().includes(query.q.toLowerCase())),
        ),
      )
      .handle("repeats", ({ query }) =>
        Effect.map(CurrentUser, (user) =>
          repeatsFor(data, user, epochMs(query.from), epochMs(query.to), Date.now()),
        ),
      )
      .handle("programme", ({ params }) =>
        Effect.suspend(() => {
          const found = data.programmes.find((p) => p.id === params.programmeId);
          return found ? Effect.succeed(found) : notFound("programme", params.programmeId);
        }),
      ),
  );
};
