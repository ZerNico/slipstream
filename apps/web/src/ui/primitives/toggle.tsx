import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "~/ui/utils.ts";

/** A pressable chip (SPEC §4 Chip): outlined at rest, filled with the text colour when pressed. */
const toggleVariants = cva("chip", {
  variants: { size: { sm: "chip-sm", md: "" } },
  defaultVariants: { size: "md" },
});

function Toggle({
  className,
  size,
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ size }), className)}
      {...props}
    />
  );
}

export { Toggle };
