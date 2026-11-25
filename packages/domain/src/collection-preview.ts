import {
  type Collection,
  type CollectionLayout,
  matchCollection,
  type PlacementReason,
} from "./collection.ts";
import { seriesCollection } from "./collection-offer.ts";
import {
  type GroupingContext,
  type GroupPath,
  groupRecording,
  type GroupSubject,
  type PathSegment,
} from "./grouping.ts";
import { CollectionId, type RecordingId } from "./ids.ts";
import type { Programme } from "./programme.ts";
import { normaliseText } from "./title.ts";

/** A library recording as the collection editor's preview reads it. */
export interface PreviewSubject extends GroupSubject {
  readonly id: RecordingId;
  /** The collection of the rule that recorded it, if any. */
  readonly ruleCollectionId?: CollectionId | undefined;
}

/** A recording the draft would hold, where it would sit, and where it sits today. */
export interface DraftPlaced<S extends PreviewSubject> {
  readonly subject: S;
  /** Its path inside the draft; items the layout cannot split sit under "Other". */
  readonly path: GroupPath;
  /** Where it appears without the draft: another collection or an automatic group. */
  readonly from: GroupPath;
}

/** A recording the draft matches but that stays in another collection, and why. */
export interface DraftElsewhere<S extends PreviewSubject> {
  readonly subject: S;
  readonly collectionId: CollectionId;
  readonly reason: PlacementReason;
}

/** What saving a draft collection would do to the library. */
export interface DraftPreview<S extends PreviewSubject> {
  readonly placed: ReadonlyArray<DraftPlaced<S>>;
  readonly elsewhere: ReadonlyArray<DraftElsewhere<S>>;
}

/**
 * Previews a draft collection against the library with the real precedence (pinned by hand, the
 * rule's collection, most specific matcher, ranking), so the editor's tree shows exactly what
 * would move into it and what it matches but loses to another collection. `others` may contain
 * the stored version of the collection being edited; it is replaced by the draft.
 */
export const previewCollection = <S extends PreviewSubject>(
  draft: Collection,
  others: ReadonlyArray<Collection>,
  recordings: ReadonlyArray<S>,
  context: GroupingContext,
): DraftPreview<S> => {
  const without = others.filter((collection) => collection.id !== draft.id);
  const withDraft = [...without, draft];
  const placed: Array<DraftPlaced<S>> = [];
  const elsewhere: Array<DraftElsewhere<S>> = [];
  for (const subject of recordings) {
    if (matchCollection(draft, subject, context.timeZone) === undefined) continue;
    const options = { ...context, ruleCollectionId: subject.ruleCollectionId };
    const next = groupRecording(subject, withDraft, options);
    if (next.placement?.collection.id === draft.id) {
      placed.push({
        subject,
        path: next.path,
        from: groupRecording(subject, without, options).path,
      });
    } else if (next.placement !== undefined) {
      elsewhere.push({
        subject,
        collectionId: next.placement.collection.id,
        reason: next.placement.reason,
      });
    }
  }
  return { placed, elsewhere };
};

/** The id of the draft the offer preview groups into; never stored. */
const offerDraftId = CollectionId.make("offer-preview");

const sameText = (a: PathSegment | undefined, b: PathSegment): boolean =>
  a?._tag === "Text" &&
  b._tag === "Text" &&
  normaliseText(a.text).toLowerCase() === normaliseText(b.text).toLowerCase();

/**
 * The segments a path is shown as in a one-line preview: folders, then the item unless it only
 * repeats the collection's name. A title the layout cannot split sits under "Other" with the
 * whole title as its item, which for a programme named like its collection would read
 * "Nachrichten › Other › Nachrichten"; the preview says "Nachrichten › Other".
 */
export const previewSegments = (path: GroupPath): ReadonlyArray<PathSegment> =>
  path.source === "collection" && sameText(path.folders[0], path.item)
    ? path.folders
    : [...path.folders, path.item];

/**
 * Where `programme` would sit in a collection named `name` with `layout` (the collection offer
 * after "Record every…", recording model §3.3): the draft holds what the series recording records
 * (`seriesCollection`), so the title start is cut off before the layout splits the rest, as it
 * will be once the collection follows the series recording. Rendered with `previewSegments`.
 */
export const offerPreviewPath = (
  name: string,
  layout: CollectionLayout,
  programme: Programme,
  context: GroupingContext,
): ReadonlyArray<PathSegment> => {
  const draft: Collection = {
    id: offerDraftId,
    name: name.trim(),
    rank: 0,
    matcher: seriesCollection(programme).matcher,
    labels: [],
    layout,
  };
  return previewSegments(groupRecording({ ...programme, labels: [] }, [draft], context).path);
};
