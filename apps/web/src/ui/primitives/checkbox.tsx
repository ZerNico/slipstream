import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Icon } from "~/ui/icon.tsx";
import { CheckIcon } from "~/ui/icons.ts";
import { cn } from "~/ui/utils.ts";

/** A 20 px checkbox, amber when checked. Gets a 44 px hit area on touch. */
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root data-slot="checkbox" className={cn("check hit", className)} {...props}>
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator">
        <Icon icon={CheckIcon} size={14} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
