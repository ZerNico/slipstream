import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Fragment, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Section, SectionHead } from "~/ui/page.tsx";

/** One titled run of items in a sectioned grid (a day, a channel). */
export interface GridSection<T> {
  readonly key: string;
  readonly title: ReactNode;
  readonly items: readonly T[];
}

interface GridProps<T> {
  readonly sections: readonly GridSection<T>[];
  /** The grid's classes (its columns and gaps per breakpoint), as on a plain grid. */
  readonly grid: string;
  readonly itemKey: (item: T) => string;
  readonly renderItem: (item: T) => ReactNode;
}

/**
 * More items than this and the grid draws only the rows near the screen. Below it, every item
 * is in the page as plain sections, so Tab walks all of them and find-in-page finds them.
 */
const windowAbove = 60;

/** The space between sections, as `.section + .section`. */
const sectionGap = 40;

/**
 * Sections of cards in a grid (the library by date or channel). A long library (thousands of
 * recordings) draws only the rows around the screen, so it opens and scrolls as fast as a short
 * one; a short one is plain sections.
 */
export function SectionedGrid<T>(props: GridProps<T>) {
  const total = props.sections.reduce((count, section) => count + section.items.length, 0);
  if (total > windowAbove) return <WindowedSections {...props} />;
  return props.sections.map((section) => (
    <Section key={section.key} title={section.title}>
      <div className={props.grid}>
        {section.items.map((item) => (
          <Fragment key={props.itemKey(item)}>{props.renderItem(item)}</Fragment>
        ))}
      </div>
    </Section>
  ));
}

/** A section head or one row of a section's grid, as the windowed list lays them out. */
type Entry<T> =
  | {
      readonly kind: "head";
      readonly key: string;
      readonly title: ReactNode;
      readonly first: boolean;
    }
  | {
      readonly kind: "row";
      readonly key: string;
      readonly items: readonly T[];
      readonly last: boolean;
    };

/** How the grid lays out at this width: read from a hidden row of it. */
interface Shape {
  readonly columns: number;
  readonly rowGap: number;
  readonly rowHeight: number;
}

const sameShape = (a: Shape, b: Shape) =>
  a.columns === b.columns && a.rowGap === b.rowGap && a.rowHeight === b.rowHeight;

function WindowedSections<T>({ sections, grid, itemKey, renderItem }: GridProps<T>) {
  // TanStack Virtual hands back one mutable object; the compiler must not cache what it draws.
  "use no memo";
  const list = useRef<HTMLDivElement | null>(null);
  const probe = useRef<HTMLDivElement | null>(null);
  // A first guess, replaced from the hidden row before the first paint.
  const [shape, setShape] = useState<Shape>({ columns: 4, rowGap: 28, rowHeight: 200 });
  const [margin, setMargin] = useState(0);

  // The columns, the gap and a row's height come from the grid's own CSS at this width (a
  // hidden row of one item), and where the list starts on the page; again on every resize.
  useLayoutEffect(() => {
    const read = () => {
      const row = probe.current;
      const element = list.current;
      if (!row || !element) return;
      const style = getComputedStyle(row);
      const next = {
        columns: Math.max(1, style.gridTemplateColumns.split(" ").filter(Boolean).length),
        rowGap: Number.parseFloat(style.rowGap) || 0,
        rowHeight: row.getBoundingClientRect().height,
      };
      setShape((current) => (sameShape(current, next) ? current : next));
      const top = element.getBoundingClientRect().top + window.scrollY;
      setMargin((current) => (current === top ? current : top));
    };
    read();
    const observer = new ResizeObserver(read);
    if (probe.current) observer.observe(probe.current);
    // Anything above the list changing height moves where it starts.
    observer.observe(document.body);
    return () => observer.disconnect();
  }, []);

  const entries = useMemo(() => {
    const out: Entry<T>[] = [];
    sections.forEach((section, index) => {
      out.push({ kind: "head", key: `h:${section.key}`, title: section.title, first: index === 0 });
      for (let start = 0; start < section.items.length; start += shape.columns) {
        out.push({
          kind: "row",
          key: `r:${section.key}:${shape.columns}:${start}`,
          items: section.items.slice(start, start + shape.columns),
          last: start + shape.columns >= section.items.length,
        });
      }
    });
    return out;
  }, [sections, shape.columns]);

  // The compiler skips this component ("use no memo" above), which is what this rule asks for.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useWindowVirtualizer({
    count: entries.length,
    // Heads are 32 px tall with 14 px below (`.section-head`), and the gap above all but the
    // first; rows are the hidden row's height and the gap below all but a section's last.
    estimateSize: (index) => {
      const entry = entries[index];
      if (entry?.kind === "head") return 46 + (entry.first ? 0 : sectionGap);
      return shape.rowHeight + (entry?.last ? 0 : shape.rowGap);
    },
    getItemKey: (index) => entries[index]?.key ?? index,
    overscan: 4,
    scrollMargin: margin,
  });

  // A new width changes every row's height; measure again rather than keep the old sizes.
  useLayoutEffect(() => {
    virtualizer.measure();
  }, [virtualizer, shape]);

  const first = sections[0]?.items[0];
  return (
    <div
      ref={list}
      // A section, for the space after what comes before (`.section + .section`).
      className="section relative"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {first === undefined ? null : (
        <div
          ref={probe}
          className={grid}
          aria-hidden="true"
          inert
          style={{ position: "absolute", insetInline: 0, top: 0, visibility: "hidden" }}
        >
          {renderItem(first)}
        </div>
      )}
      {virtualizer.getVirtualItems().map((item) => {
        const entry = entries[item.index];
        if (entry === undefined) return null;
        return (
          <div
            key={item.key}
            ref={virtualizer.measureElement}
            data-index={item.index}
            style={{
              position: "absolute",
              insetInline: 0,
              top: 0,
              transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
            }}
          >
            {entry.kind === "head" ? (
              // flow-root keeps the head's bottom margin inside, so the measured box has it.
              <div className="flow-root" style={{ paddingTop: entry.first ? 0 : sectionGap }}>
                <SectionHead title={entry.title} />
              </div>
            ) : (
              <div className={grid} style={{ paddingBottom: entry.last ? 0 : shape.rowGap }}>
                {entry.items.map((value) => (
                  <Fragment key={itemKey(value)}>{renderItem(value)}</Fragment>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
