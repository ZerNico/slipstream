import type { CollectionOffer, RuleId } from "@slipstream/domain";
import { Effect } from "effect";
import type { Api } from "../api/client.ts";
import { apiActions } from "../api/queries.ts";

/** The record sheet's second step after "Record series": "Group these as “Live F1”?". */
export interface OfferStep {
  readonly ruleId: RuleId;
  readonly offer: CollectionOffer;
}

/**
 * The collection offer for a series recording just created (`GET /rules/:id/offer`), or
 * undefined when its programmes do not scatter. A failed check offers nothing: the library card
 * and the series options keep the offer, so nothing is lost.
 */
export const offerAfterCreate = (
  ruleId: RuleId,
): Effect.Effect<OfferStep | undefined, never, Api> =>
  apiActions.ruleOffer(ruleId).pipe(
    Effect.map(({ offer }) => (offer === undefined ? undefined : { ruleId, offer })),
    Effect.orElseSucceed(() => undefined),
  );

/** Runs one write as the profile in use (`runAction`) and refreshes what it changed. */
export type RunWrite = <A, E>(effect: Effect.Effect<A, E, Api>) => Promise<A>;

/**
 * The Undo after "Record series" when no offer follows: deletes the series recording just
 * created with `undo=true`, so what it scheduled goes too (within the server's undo window).
 */
export const seriesUndo = (ruleId: RuleId, run: RunWrite) => (): Promise<void> =>
  run(apiActions.deleteRule(ruleId, { undo: true })).then(() => undefined);

/** What the offer step's buttons need from the sheet around it. */
export interface OfferStepHandlers {
  readonly run: RunWrite;
  /** Closes the step, and with it the sheet. */
  readonly close: () => void;
  /**
   * Says the programmes were grouped, with Undo (`undo` takes the collection away again). The
   * sheet decides where Undo lives: a focused row in the sheet on TV, a toast on phone.
   */
  readonly grouped: (name: string, undo: () => Promise<void>) => void;
  /** The write did not go through; the step stays so the person can try again. */
  readonly failed: () => void;
}

/**
 * The offer step's buttons (recording model §3.1, TV and phone). *Group them* creates the
 * collection that follows the series recording (`POST /rules/:id/collection`) with the offered
 * name and layout and hands the sheet its Undo (`DELETE /rules/:id/collection`). *Not now*
 * and Back only close the step: they never decline the offer, so one accidental press loses
 * nothing; the permanent "No thanks" lives on the web.
 */
export const offerStepActions = (step: OfferStep, handlers: OfferStepHandlers) => ({
  groupThem: (): Promise<void> =>
    handlers
      .run(apiActions.groupRule(step.ruleId, { name: step.offer.name, layout: step.offer.layout }))
      .then(
        () =>
          handlers.grouped(step.offer.name, () =>
            handlers.run(apiActions.ungroupRule(step.ruleId)).then(() => undefined),
          ),
        () => handlers.failed(),
      ),
  notNow: (): void => handlers.close(),
});
