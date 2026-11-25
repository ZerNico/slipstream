import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { cn } from "~/ui/utils.ts";

/**
 * The segmented control (SPEC §4 Segmented): `md` outside with 32 px inner pills; the pressed
 * pill is the surface colour. Under a coarse pointer the whole 44 px is the button.
 */
function ToggleGroup({ className, ...props }: ToggleGroupPrimitive.Props) {
  return (
    <ToggleGroupPrimitive data-slot="toggle-group" className={cn("seg", className)} {...props} />
  );
}

function ToggleGroupItem({ className, ...props }: TogglePrimitive.Props) {
  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      className={cn("seg-item", className)}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
