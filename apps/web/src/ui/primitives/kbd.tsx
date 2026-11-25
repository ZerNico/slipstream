import type { ComponentProps } from "react";
import { cn } from "~/ui/utils.ts";

/** A key cap. Hidden unless the device has a fine, hovering pointer (SPEC §7.2). */
function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return <kbd data-slot="kbd" className={cn("kbd", className)} {...props} />;
}

export { Kbd };
