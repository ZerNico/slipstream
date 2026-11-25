import type { SourceId } from "@slipstream/domain";
import { useOverlay } from "~/ui/overlay/use-overlay.tsx";

/** The suffix of the picker's argument that opens it on the new streams only. */
const newOnly = ":new";

/**
 * Opens the stream picker for a source (`?dlg=streams:<id>`), or on its new streams only
 * (`?dlg=streams:<id>:new`, from Needs review).
 */
export const useOpenPicker = () => {
  const overlay = useOverlay();
  return (id: SourceId, options: { readonly onlyNew?: boolean } = {}) =>
    overlay.open({
      kind: "dlg",
      name: "streams",
      arg: options.onlyNew === true ? `${id}${newOnly}` : id,
    });
};

/** The source and view a picker argument names. */
export const pickerArg = (
  arg: string | undefined,
): { readonly id: string | undefined; readonly onlyNew: boolean } =>
  arg?.endsWith(newOnly) === true
    ? { id: arg.slice(0, -newOnly.length), onlyNew: true }
    : { id: arg, onlyNew: false };
