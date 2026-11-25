import { useId, useLayoutEffect, useRef, useState } from "react";
import type { CollectionOffer, Rule } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { Icon } from "~/ui/icon.tsx";
import { CheckIcon } from "~/ui/icons.ts";
import { Button } from "~/ui/primitives/button.tsx";
import { Input } from "~/ui/primitives/input.tsx";
import { LoadingScope, Sk } from "~/ui/skeleton.tsx";
import { cn } from "~/ui/utils.ts";
import { useWillRecord } from "../queries.ts";
import { inlineLink } from "./inline-link.ts";

/** "6 will record", or its skeleton while the count is not known. */
function WillRecordLine({ count }: { count: number | undefined }) {
  return (
    <LoadingScope as="span" loading={count === undefined}>
      <Sk chars={14}>{count === undefined ? undefined : m.series_preview_count({ count })}</Sk>
    </LoadingScope>
  );
}

function WillRecord({ rule }: { rule: Rule }) {
  return <WillRecordLine count={useWillRecord(rule)} />;
}

/**
 * The scheduled-by-series box's second line: "6 will record" (the series preview's count, as
 * the series recording editor shows it), or the collection offer in the same line box. Both are
 * laid out in one grid cell, so swapping them moves nothing (SPEC §6).
 */
export function SeriesLine({
  rule,
  offer,
  offerOpen,
  onOpenOffer,
}: {
  /** The series recording; undefined while it is read again (a skeleton of the same line). */
  rule: Rule | undefined;
  offer: CollectionOffer | undefined;
  offerOpen: boolean;
  onOpenOffer: () => void;
}) {
  return (
    <span className="grid [grid-template-areas:'line'] *:[grid-area:line]" data-series-line="">
      <span className={cn(offer !== undefined && "invisible")} aria-hidden={offer !== undefined}>
        {rule === undefined ? <WillRecordLine count={undefined} /> : <WillRecord rule={rule} />}
      </span>
      <span className={cn(offer === undefined && "invisible")} aria-hidden={offer === undefined}>
        {m.guide_offer_line({ count: offer?.groups ?? 3 })}
        {" · "}
        <button
          type="button"
          className={inlineLink}
          tabIndex={offer === undefined ? -1 : undefined}
          aria-expanded={offerOpen}
          onClick={onOpenOffer}
        >
          {m.guide_offer_open()}
        </button>
      </span>
    </span>
  );
}

/**
 * The collection offer's inline step (recording model §3.3), opened by "Group them…" in the
 * scheduled status box: the name prefilled from the title start and selected, so typing
 * replaces it; a one-line preview of where recordings will sit; Group them (Enter) and No
 * thanks. Esc closes only the step, never the sheet.
 */
export function OfferStep({
  offer,
  preview,
  busy,
  declining,
  onGroup,
  onDecline,
  onClose,
}: {
  offer: CollectionOffer;
  /** Where this programme would sit for a name: "Live F1 › 2026 › GP Katar › Rennen". */
  preview: (name: string) => string;
  busy: boolean;
  declining: boolean;
  onGroup: (name: string) => void;
  onDecline: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(offer.name);
  const input = useRef<HTMLInputElement | null>(null);
  const inputId = useId();
  const titleId = useId();

  useLayoutEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  return (
    <form
      className="grid gap-3 border-t border-line bg-hover px-4 py-3.5"
      aria-labelledby={titleId}
      noValidate
      data-offer-step=""
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() === "" || busy) return;
        onGroup(name.trim());
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="grid gap-1">
        <p id={titleId} className="text-[14.5px] font-semibold">
          {m.guide_offer_title({ name: offer.name })}
        </p>
      </div>
      <div className="field">
        <label className="field-label" htmlFor={inputId}>
          {m.offer_name()}
        </label>
        <Input
          ref={input}
          id={inputId}
          value={name}
          autoComplete="off"
          enterKeyHint="done"
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <p className="-mt-1 truncate type-meta" data-offer-preview="">
        {preview(name)}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          size="sm"
          variant="primary"
          busy={busy}
          icon={<Icon icon={CheckIcon} size={16} />}
        >
          {m.offer_group()}
        </Button>
        <Button type="button" size="sm" variant="ghost" busy={declining} onClick={onDecline}>
          {m.offer_decline()}
        </Button>
      </div>
    </form>
  );
}
