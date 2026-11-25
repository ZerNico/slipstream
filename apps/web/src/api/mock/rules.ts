import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import {
  Conflict,
  CurrentUser,
  Forbidden,
  type RuleMatchPreview,
  ruleUndoWindowMillis,
  SlipstreamApi,
} from "@slipstream/api";
import {
  canCreateCollections,
  canEditRule,
  canSeeRule,
  type Collection,
  CollectionId,
  epochMs,
  groupRecording,
  padRange,
  type Programme,
  type Rule,
  whatConditions,
} from "@slipstream/domain";
import { mockTimeZone } from "./fixtures.ts";
import { checkMatcher, draftRule, type MockContext, notFound } from "./context.ts";
import { accessOf } from "./household.ts";
import { scheduleForRule } from "./schedule.ts";
import { matchesOffer, offerFor, planForRule, resolveLinked } from "./series.ts";

/**
 * The mock's `rules` group: series recordings, their preview, the collection offer, grouping and
 * the episode history. The shared state is in context.ts.
 */
export const rulesGroup = (ctx: MockContext) => {
  const { data, regroupAll } = ctx;

  /** A rule the caller may change (`canEditRule`): their own, or any for an admin. */
  const editable = (ruleId: string) =>
    Effect.gen(function* () {
      const found = data.rules.find((r) => r.id === ruleId);
      if (found === undefined) return yield* notFound("rule", ruleId);
      const user = yield* CurrentUser;
      if (!canEditRule(found, { id: user.id, isAdmin: user.role === "admin" })) {
        return yield* new Forbidden();
      }
      return found;
    });

  const findRule = (ruleId: string) =>
    Effect.suspend(() => {
      const found = data.rules.find((r) => r.id === ruleId);
      return found ? Effect.succeed(found) : notFound("rule", ruleId);
    });

  const replaceRule = (rule: Rule) => {
    data.rules = data.rules.map((r) => (r.id === rule.id ? rule : r));
    resolveLinked(data);
    regroupAll();
    return rule;
  };

  /** The collection that follows a rule, if any. */
  const followerOf = (rule: Rule): Collection | undefined =>
    data.collections.find((collection) => collection.follows?.ruleId === rule.id);

  /** A linked collection keeps today's conditions as its own and stops following. */
  const unlink = (collection: Collection) => {
    const { follows: _follows, ...own } = collection;
    data.collections = data.collections.map((c) => (c.id === collection.id ? own : c));
  };

  return HttpApiBuilder.group(SlipstreamApi, "rules", (handlers) =>
    handlers
      .handle("list", () =>
        Effect.gen(function* () {
          const access = accessOf(data, yield* CurrentUser);
          return data.rules.filter((rule) =>
            canSeeRule(access, {
              channelIds: rule.matcher.channels,
              collectionId: rule.collectionId,
            }),
          );
        }),
      )
      .handle("get", ({ params }) => findRule(params.ruleId))
      .handle("create", ({ payload }) =>
        Effect.gen(function* () {
          yield* checkMatcher(payload);
          const user = yield* CurrentUser;
          const rule = draftRule(payload, user.id);
          data.rules = [...data.rules, rule];
          const planned = scheduleForRule(data, rule, Date.now());
          data.recordings = [...data.recordings, ...planned];
          for (const entry of planned) {
            ctx.publish({ _tag: "RecordingChanged", recordingId: entry.id, state: entry.state });
          }
          return rule;
        }),
      )
      .handle("update", ({ params, payload }) =>
        Effect.gen(function* () {
          const found = yield* editable(params.ruleId);
          const { collectionId, ...rest } = payload;
          const { collectionId: _previous, ...kept } = found;
          // null sends the rule back to Automatic; an absent key keeps its collection.
          const target =
            collectionId === undefined ? found.collectionId : (collectionId ?? undefined);
          // An absent skipRepeats keeps the rule's choice (older clients never reset it).
          const updated: Rule = {
            ...kept,
            ...rest,
            ...(target === undefined ? {} : { collectionId: target }),
          };
          yield* checkMatcher(updated);
          // Goes to moved away from the collection that follows it: that one stops following.
          const follower = followerOf(found);
          if (follower !== undefined && follower.id !== updated.collectionId) unlink(follower);
          return replaceRule(updated);
        }),
      )
      .handle("remove", ({ params, query }) =>
        Effect.gen(function* () {
          const found = yield* editable(params.ruleId);
          const user = yield* CurrentUser;
          if (query.undo === true && Date.now() - epochMs(found.createdAt) > ruleUndoWindowMillis) {
            return yield* new Conflict({ code: "undoExpired" });
          }
          const follower = followerOf(found);
          if (follower !== undefined) {
            // Undo takes back a collection made after the rule; otherwise people choose. Those
            // who may not edit collections always keep it, on an undo too.
            const remove =
              canCreateCollections(user) &&
              ((query.undo === true && follower.id === found.collectionId) ||
                query.collection === "remove");
            if (remove) data.collections = data.collections.filter((c) => c.id !== follower.id);
            else unlink(follower);
          }
          data.rules = data.rules.filter((r) => r.id !== found.id);
          // Its upcoming recordings go with it, unless someone else owns them too (they recorded
          // the airing by hand, say): then only the rule's owner leaves and it stays theirs.
          const upcoming = data.recordings.filter(
            (entry) => entry.ruleId === found.id && entry.state === "scheduled",
          );
          for (const entry of upcoming) {
            const staying = entry.ownerIds.filter((owner) => owner !== found.ownerId);
            const [first, ...rest] = staying;
            if (first === undefined) {
              data.recordings = data.recordings.filter((r) => r.id !== entry.id);
              ctx.publish({
                _tag: "RecordingRemoved",
                recordingId: entry.id,
                ownerIds: entry.ownerIds,
              });
              continue;
            }
            const { ruleId: _rule, ...kept } = entry;
            data.recordings = data.recordings.map((r) =>
              r.id === entry.id ? { ...kept, ownerIds: [first, ...rest] } : r,
            );
            ctx.publish({
              _tag: "RecordingRemoved",
              recordingId: entry.id,
              ownerIds: [found.ownerId],
            });
          }
          regroupAll();
        }),
      )
      .handle("preview", ({ payload }) =>
        Effect.gen(function* () {
          yield* checkMatcher(payload.rule);
          const user = yield* CurrentUser;
          const rule = { ...draftRule(payload.rule, user.id), enabled: true };
          const from = Date.now();
          const until = payload.until ? epochMs(payload.until) : from + 14 * 86_400_000;
          const { planned, skipped } = planForRule(data, rule, from, until);
          const groupOf = (programme: Programme) =>
            groupRecording({ ...programme, labels: [] }, data.collections, {
              timeZone: mockTimeZone,
              channelName: (id) => data.channels.find((c) => c.id === id)?.name,
              ruleCollectionId: payload.rule.collectionId,
            }).path;
          const matches: RuleMatchPreview[] = [
            ...planned.map((plan) => ({
              programme: plan.programme,
              range: plan.range,
              group: groupOf(plan.programme),
            })),
            ...skipped.map((skip) => ({
              programme: skip.programme,
              range: padRange(skip.programme, rule.padding),
              skip: skip.reason,
              group: groupOf(skip.programme),
            })),
          ].toSorted((a, b) => epochMs(a.programme.start) - epochMs(b.programme.start));
          const offer =
            payload.rule.collectionId === undefined && canCreateCollections(user)
              ? matchesOffer(
                  data,
                  matches.map((match) => match.programme),
                )
              : undefined;
          return { matches, ...(offer === undefined ? {} : { offer }) };
        }),
      )
      .handle("offer", ({ params }) =>
        Effect.gen(function* () {
          const rule = yield* findRule(params.ruleId);
          const offer = offerFor(data, rule, yield* CurrentUser, Date.now());
          return offer === undefined ? {} : { offer };
        }),
      )
      .handle("declineOffer", ({ params }) =>
        Effect.map(editable(params.ruleId), (found) =>
          replaceRule({ ...found, offerDeclined: true }),
        ),
      )
      .handle("group", ({ params, payload }) =>
        Effect.gen(function* () {
          const found = yield* editable(params.ruleId);
          if (!canCreateCollections(yield* CurrentUser)) return yield* new Forbidden();
          if (found.collectionId !== undefined) {
            return yield* new Conflict({ code: "alreadyGrouped" });
          }
          const offer = offerFor(data, found, yield* CurrentUser, Date.now());
          const collection: Collection = {
            id: CollectionId.make(crypto.randomUUID()),
            name: payload.name.trim(),
            rank: data.collections.reduce((highest, c) => Math.max(highest, c.rank), 0) + 1,
            matcher: whatConditions(found.matcher),
            labels: [],
            layout: payload.layout ??
              offer?.layout ?? {
                parts: [{ _tag: "Split", name: "programme" }],
                path: ["{year}", "{programme}"],
              },
            follows: { ruleId: found.id, ruleName: found.name },
          };
          data.collections = [...data.collections, collection];
          replaceRule({ ...found, collectionId: collection.id });
          return data.collections.find((c) => c.id === collection.id) ?? collection;
        }),
      )
      .handle("ungroup", ({ params }) =>
        Effect.gen(function* () {
          const found = yield* editable(params.ruleId);
          const follower = followerOf(found);
          if (follower !== undefined) {
            data.collections = data.collections.filter((c) => c.id !== follower.id);
          }
          const { collectionId: _collection, ...rest } = found;
          replaceRule(rest);
        }),
      )
      .handle("history", ({ params }) =>
        Effect.gen(function* () {
          const rule = yield* findRule(params.ruleId);
          const user = yield* CurrentUser;
          return {
            count: data.history.filter((row) => row.ruleId === rule.id && row.userId === user.id)
              .length,
          };
        }),
      )
      .handle("forgetHistory", ({ params }) =>
        Effect.gen(function* () {
          const rule = yield* findRule(params.ruleId);
          const user = yield* CurrentUser;
          data.history = data.history.filter(
            (row) => !(row.ruleId === rule.id && row.userId === user.id),
          );
          return { count: 0 };
        }),
      ),
  );
};
