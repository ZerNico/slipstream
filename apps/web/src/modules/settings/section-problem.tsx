import { useQueryClient } from "@tanstack/react-query";
import { m } from "@slipstream/i18n";
import { Icon } from "~/ui/icon.tsx";
import { RefreshIcon } from "~/ui/icons.ts";
import { Button } from "~/ui/primitives/button.tsx";
import { ErrorState } from "~/ui/states.tsx";
import { problemTitle } from "~/api/problem-title.ts";

/**
 * What a settings section shows when its data could not be read: the reason in plain words and
 * Try again (SPEC §8.9).
 */
export function SectionProblem({ error }: { error: unknown }) {
  const client = useQueryClient();
  return (
    <ErrorState
      title={problemTitle(error)}
      actions={
        <Button
          icon={<Icon icon={RefreshIcon} />}
          onClick={() => void client.refetchQueries({ type: "active" })}
        >
          {m.action_try_again()}
        </Button>
      }
    />
  );
}
