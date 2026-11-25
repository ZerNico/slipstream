import type { SeriesDraft } from "@slipstream/domain";

/** Changes part of the editor's draft. */
export type UpdateDraft = (patch: Partial<SeriesDraft>) => void;

/** One option of a radio group: a 44 px row with its label and, under it, a help line. */
export function RadioRow({
  name,
  checked,
  onSelect,
  label,
  help,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  label: string;
  help?: string;
}) {
  return (
    // The whole row is the target: the native radio is kept for keyboard and assistive tech, and
    // drawn by the circle next to it.
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md py-1.5 text-[14px] has-disabled:cursor-default">
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="mt-0.5 grid size-4.5 shrink-0 place-items-center rounded-full border-2 border-line-2 peer-checked:border-brand peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus peer-disabled:opacity-60 after:size-2 after:rounded-full after:bg-brand after:opacity-0 after:content-[''] peer-checked:after:opacity-100"
      />
      <span className="grid min-w-0 gap-0.5">
        <span className="font-[550]">{label}</span>
        {help === undefined ? null : <span className="text-[12.5px] text-fg-3">{help}</span>}
      </span>
    </label>
  );
}
