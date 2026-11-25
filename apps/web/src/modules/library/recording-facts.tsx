import { Link } from "@tanstack/react-router";
import { Fragment, type ReactNode } from "react";
import { m } from "@slipstream/i18n";
import { Sk } from "~/ui/skeleton.tsx";
import { exportFact } from "./detail.ts";
import type { Entry } from "./library.ts";
import type { LibraryData } from "./queries.ts";
import { keepWords } from "./words.ts";

/** One fact row of the detail's list. */
function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-fg-3">{term}</dt>
      <dd className="m-0 min-w-0">{children}</dd>
    </>
  );
}

/**
 * A file path that may break after each separator and nowhere else unless it must
 * (`overflow-wrap: anywhere` covers a single overlong segment), so "/media/tv/Formel 1/…"
 * wraps at its folders instead of mid-word.
 */
function BreakablePath({ path }: { path: string }) {
  const parts = path.split("/");
  return (
    <code className="font-mono [overflow-wrap:anywhere]">
      {parts.map((part, index) => (
        // The parts of one path never reorder, so their position is a stable key.
        // oxlint-disable-next-line react/no-array-index-key -- positional by nature
        <Fragment key={index}>
          {part}
          {index < parts.length - 1 ? (
            <>
              /<wbr />
            </>
          ) : null}
        </Fragment>
      ))}
    </code>
  );
}

/**
 * The detail's facts: who recorded it (and from which series recording), how long it is kept,
 * and where its file is (or will be) exported. Skeleton text while the recording loads.
 */
export function RecordingFacts({
  entry,
  data,
  scheduled,
}: {
  entry: Entry | undefined;
  data: LibraryData;
  scheduled: boolean;
}) {
  const exported = entry ? exportFact(entry) : undefined;
  const ruleName = data.ruleName(entry?.ruleId);
  const person = entry ? (data.person(entry.ownerIds[0]) ?? "") : "";
  const collection = data.collections.find((c) => c.id === entry?.group.collectionId);
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-5 gap-y-2 text-[13.5px] text-fg-2">
      <Fact term={scheduled ? m.library_fact_will_record_by() : m.library_fact_recorded_by()}>
        <Sk chars={18}>
          {entry && entry.ruleId !== undefined && ruleName !== undefined ? (
            <>
              {m.library_from_series()}{" "}
              {/* Inline text: an invisible hit area at least 44 × 44 px, whatever the line height. */}
              <Link
                to="/series/$id"
                params={{ id: entry.ruleId }}
                className="tap-area underline underline-offset-2 fine:hover:text-fg"
              >
                {ruleName}
              </Link>
              {person ? ` · ${person}` : ""}
            </>
          ) : entry ? (
            person ? (
              m.library_recorded_by({ how: m.recordings_by_hand(), person })
            ) : (
              m.recordings_by_hand()
            )
          ) : (
            ""
          )}
        </Sk>
      </Fact>
      <Fact term={m.library_editor_keep()}>
        <Sk chars={13}>{entry ? keepWords(collection?.retention) : ""}</Sk>
      </Fact>
      {/* Only when there is a file to point to (or one coming). */}
      {exported === undefined ||
      exported.kind === "off" ||
      exported.kind === "nothingCaptured" ? null : (
        <Fact term={m.library_fact_exported()}>
          <span className="text-[13px]">
            <Sk chars={25}>
              {exported.kind === "planned" ? (
                <>
                  <span className="text-fg-2">{m.library_export_when_ends()} </span>
                  <BreakablePath path={exported.path} />
                </>
              ) : (
                <BreakablePath path={exported.path} />
              )}
            </Sk>
          </span>
        </Fact>
      )}
    </dl>
  );
}
