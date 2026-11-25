import type { ComponentProps, ReactNode } from "react";
import { cn } from "~/ui/utils.ts";

/*
 * The building blocks every settings section shares (SPEC §8.7): a section with its heading
 * and action, and list panels with rows.
 * Styled with token utilities only.
 */

/** A settings section: an `h2` and an optional action on the right. */
export function SettingsSection({
  title,
  action,
  children,
  id,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  const headingId = id === undefined ? undefined : `${id}-title`;
  return (
    <section className="mb-10 grid gap-3" aria-labelledby={headingId} id={id}>
      <header className="flex min-h-9 flex-wrap items-center gap-3">
        <h2 className="mr-auto min-w-0 type-h3" id={headingId}>
          {title}
        </h2>
        {action}
      </header>
      {children}
    </section>
  );
}

/** A panel of rows separated by hairlines. */
export function ListPanel({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("panel grid divide-y divide-line overflow-hidden", className)} {...props} />
  );
}

/**
 * One row of a list panel: an icon or avatar, a title that wraps (never "Look up missing
 * artwork a…"), a line under it, then the row's controls. `pending` marks invites and TV
 * requests with a 3 px amber edge and a faint tint.
 */
export function ListRow({
  lead,
  title,
  sub,
  extra,
  end,
  pending = false,
  stackOnPhone = false,
  className,
  ...props
}: Omit<ComponentProps<"div">, "title"> & {
  lead?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  extra?: ReactNode;
  end?: ReactNode;
  pending?: boolean;
  stackOnPhone?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-3.5 px-4.5 py-3.5",
        pending &&
          "bg-[color-mix(in_oklab,var(--brand)_6%,transparent)] shadow-[inset_3px_0_0_var(--brand)]",
        stackOnPhone && "max-sm:flex-wrap",
        className,
      )}
      {...props}
    >
      {lead}
      <div className={cn("min-w-0 flex-1", stackOnPhone && "max-sm:basis-full")}>
        <div className="text-[14.5px] font-semibold [overflow-wrap:anywhere]">{title}</div>
        {sub === undefined ? null : <div className="text-meta text-fg-2">{sub}</div>}
        {extra}
      </div>
      {end}
    </div>
  );
}
