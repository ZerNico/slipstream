import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "~/ui/utils.ts";

/** A text field at the `md` height: hover outline, 2 px amber inset on focus, red when invalid. */
function Input({ className, type = "text", ...props }: InputPrimitive.Props) {
  return (
    <InputPrimitive type={type} data-slot="input" className={cn("input", className)} {...props} />
  );
}

export { Input };
