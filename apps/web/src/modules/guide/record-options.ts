import {
  type CollectionLayout,
  type EffectiveExtraTime,
  type ExtraTimeHint,
  type GroupingContext,
  type GroupPath,
  offerPreviewPath,
  type Padding,
  type PathLabels,
  type Programme,
  renderSegment,
} from "@slipstream/domain";

/*
 * The programme sheet's record section as pure logic (SPEC §7.7, §8.3): the extra-time hint and
 * the offer's layout preview. Its state, second row, conflict and stepper bounds are the
 * domain's and the server's (`recordSheetState`, `RecordOptions.every`, `scheduleConflictFor`,
 * `paddingLimits`), shared with the TV.
 */

/** The name a group path is known by: the collection, else its first folder ("Formel 1"). */
export const groupName = (path: GroupPath, labels: PathLabels): string =>
  renderSegment(path.folders[0] ?? path.item, labels);

// ---------------------------------------------------------------------------------------------
// Extra time

/**
 * The hint and the stepper values: the extra time the server resolved for this programme (the
 * channel default beats the category default beats the global one), or what the viewer chose
 * on the steppers, and whether that differs from the default.
 */
export const extraTimeHint = (
  effective: EffectiveExtraTime,
  chosen: Padding | undefined,
): ExtraTimeHint => {
  const padding = chosen ?? effective.padding;
  return {
    padding,
    fallback: effective,
    overridesDefault:
      padding.beforeMinutes !== effective.padding.beforeMinutes ||
      padding.afterMinutes !== effective.padding.afterMinutes,
  };
};

// ---------------------------------------------------------------------------------------------
// The collection offer (recording model §3.3)

/**
 * Where this programme would sit in a collection named `name` with the offer's layout, as the
 * one-line preview of the offer step ("Live F1 › 2026 › GP Katar › Rennen"): the domain's
 * `offerPreviewPath`, which never repeats the collection's name as the item.
 */
export const offerPreview = (
  name: string,
  layout: CollectionLayout,
  programme: Programme,
  labels: PathLabels,
  context: GroupingContext,
): string =>
  offerPreviewPath(name, layout, programme, context)
    .map((segment) => renderSegment(segment, labels))
    .filter((segment) => segment.trim() !== "")
    .join(" › ");
