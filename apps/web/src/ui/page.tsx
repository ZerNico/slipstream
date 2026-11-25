import { Link, type LinkProps } from "@tanstack/react-router";
import type { ComponentProps, ReactNode } from "react";
import { Icon } from "~/ui/icon.tsx";
import { ChevronRightIcon } from "~/ui/icons.ts";
import { cn } from "~/ui/utils.ts";

/** The content column: centred, capped at 1520 px, gutters and safe areas on both sides. */
export function Wrap({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("wrap", className)} {...props} />;
}

/**
 * A page header (SPEC §2.3): the title (an `h1`), optional actions on the right, an optional
 * line under it. Inside the content column.
 */
export function PageHeader({
  title,
  actions,
  sub,
}: {
  title: ReactNode;
  actions?: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <header className="page-head">
      <h1 className="page-head-title type-h1">{title}</h1>
      {actions}
      {sub === undefined ? null : <div className="page-head-sub type-meta">{sub}</div>}
    </header>
  );
}

/** A section's head: an `h2`, an optional "more" link (also the windowed grid's section heads). */
export function SectionHead({
  title,
  more,
}: {
  title: ReactNode;
  /** The section's "more" link: label and where it goes. */
  more?: { readonly label: string; readonly to: NonNullable<LinkProps["to"]> } | undefined;
}) {
  return (
    <div className="section-head">
      <h2 className="section-head-title type-h2">
        {typeof title === "string" ? <span className="section-head-text">{title}</span> : title}
      </h2>
      {more ? (
        <Link to={more.to} className="section-more">
          {more.label}
          <Icon icon={ChevronRightIcon} size={16} />
        </Link>
      ) : null}
    </div>
  );
}

/** A section with its head: an `h2`, an optional "more" link. Sections are 40 px apart. */
export function Section({
  title,
  more,
  children,
  className,
  ...props
}: Omit<ComponentProps<"section">, "title"> & {
  title?: ReactNode;
  /** The section's "more" link: label and where it goes. */
  more?: { readonly label: string; readonly to: NonNullable<LinkProps["to"]> };
}) {
  return (
    <section className={cn("section", className)} {...props}>
      {title === undefined ? null : <SectionHead title={title} more={more} />}
      {children}
    </section>
  );
}

/** One route tab: a link that marks itself current. */
export interface TabLink {
  readonly label: string;
  readonly to: NonNullable<LinkProps["to"]>;
  /** A count after the label; `warn` tints it orange (Problems). */
  readonly count?: number;
  readonly tone?: "warn";
}

/**
 * Tabs that are routes (Recordings › Library / Scheduled / Problems): links in a `nav`, the
 * current one with the amber bar, counts in a reserved pill.
 */
export function TabLinks({ label, tabs }: { label: string; tabs: readonly TabLink[] }) {
  return (
    <nav className="tabs" aria-label={label}>
      {tabs.map((tab) => (
        <Link key={tab.to} to={tab.to} className="tab" activeOptions={{ exact: true }}>
          {tab.label}
          {tab.count === undefined ? null : (
            <span className="tab-count sk" data-tone={tab.tone}>
              {tab.count}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}

/** A row of controls that share one height (SPEC §3.5): gap 10, wraps. */
export function Toolbar({ className, ...props }: ComponentProps<"div">) {
  return <div role="toolbar" className={cn("toolbar", className)} {...props} />;
}
