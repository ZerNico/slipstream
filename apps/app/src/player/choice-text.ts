import { watchOptionText } from "@slipstream/i18n";
import type { ChoiceOption, RecordingChoice } from "@slipstream/domain";
import type { IconName } from "../ui/Icon.tsx";

const icons: Readonly<Record<ChoiceOption["kind"], IconName>> = {
  resume: "play",
  start: "start",
  live: "live",
};

/**
 * One option's icon, title and hint. The words are every client's (`watchOptionText`), written
 * against `now` so the hint keeps up while the sheet is open.
 */
export const optionText = (
  option: ChoiceOption,
  choice: RecordingChoice,
  now: number,
): { readonly icon: IconName; readonly title: string; readonly hint: string } => {
  const text = watchOptionText(option, { ...choice, now });
  return { icon: icons[option.kind], title: text.title, hint: text.detail };
};
