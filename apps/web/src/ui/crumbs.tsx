import { Link, type LinkProps } from "@tanstack/react-router";
import { Fragment } from "react";
import { m } from "@slipstream/i18n";
import { Icon } from "~/ui/icon.tsx";
import { ChevronLeftIcon, ChevronRightIcon } from "~/ui/icons.ts";
import { Sk } from "~/ui/skeleton.tsx";
import { cn } from "~/ui/utils.ts";

/** One breadcrumb: a link, plain text, or the current page (last, bold). */
export interface Crumb {
  readonly label: string;
  readonly link?: LinkProps;
  /** While loading with no label yet: how many characters wide the placeholder is. */
  readonly chars?: number;
}

const crumbClass = "inline-flex min-h-8 min-w-0 items-center rounded-sm px-2 py-1 coarse:min-h-tap";

/** A crumb's text: its label, or a transparent bar of the usual length while it loads. */
function CrumbText({ crumb }: { crumb: Crumb }) {
  return (
    <Sk
      {...(crumb.label === "" ? { chars: crumb.chars ?? 12 } : { placeholder: crumb.label })}
      className="min-w-0 truncate"
    >
      {crumb.label}
    </Sk>
  );
}

/**
 * The way back on a narrow screen: the parent's name, linked to the nearest crumb above the
 * current page that has a page of its own ("‹ GP Katar" opens the season it sits in). Undefined
 * when nothing above links anywhere.
 */
const backCrumb = (crumbs: readonly Crumb[]): Crumb | undefined => {
  const above = crumbs.slice(0, -1);
  const parent = above.at(-1);
  const link = above.findLast((crumb) => crumb.link !== undefined)?.link;
  return parent === undefined || link === undefined ? undefined : { label: parent.label, link };
};

/**
 * The breadcrumb trail above the Recordings pages and the editors (collection, series). One
 * line: the crumbs on the way truncate more than the current page, so a long title never wraps
 * and pushes the page down. Under 768 px the trail collapses to one back link to the parent
 * ("‹ GP Katar"), a full 44 px target; the page's own title is the heading right below it.
 */
export function Crumbs({ crumbs, className }: { crumbs: readonly Crumb[]; className?: string }) {
  const back = backCrumb(crumbs);
  return (
    <nav
      aria-label={m.library_crumbs_label()}
      className={cn(
        "flex min-w-0 items-center gap-1 overflow-hidden pt-6 text-sm whitespace-nowrap text-fg-2",
        className,
      )}
    >
      {back?.link === undefined ? null : (
        <Link
          {...back.link}
          className="-ml-2 inline-flex min-h-tap max-w-full min-w-tap items-center gap-1 rounded-sm pr-2 pl-1 font-medium md:hidden fine:hover:bg-hover fine:hover:text-fg"
        >
          <Icon icon={ChevronLeftIcon} size={16} className="shrink-0" />
          <CrumbText crumb={back} />
        </Link>
      )}
      <span
        className={`min-w-0 items-center gap-1 overflow-hidden ${back === undefined ? "flex" : "flex max-md:hidden"}`}
      >
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <Fragment
              key={crumbs
                .slice(0, index + 1)
                .map((c) => c.label)
                .join("/")}
            >
              {index > 0 ? (
                <Icon icon={ChevronRightIcon} size={14} className="shrink-0 text-fg-4" />
              ) : null}
              {last ? (
                <b
                  className={`${crumbClass} max-w-full shrink-[0.25] font-semibold text-fg`}
                  aria-current="page"
                >
                  <CrumbText crumb={crumb} />
                </b>
              ) : crumb.link ? (
                <Link
                  {...crumb.link}
                  className={`${crumbClass} font-medium fine:hover:bg-hover fine:hover:text-fg`}
                >
                  <CrumbText crumb={crumb} />
                </Link>
              ) : (
                <span className={crumbClass}>
                  <CrumbText crumb={crumb} />
                </span>
              )}
            </Fragment>
          );
        })}
      </span>
    </nav>
  );
}
