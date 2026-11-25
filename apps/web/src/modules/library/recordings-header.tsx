import { useQuery } from "@tanstack/react-query";
import { problemChains } from "@slipstream/domain";
import { useQueries } from "~/api/hooks.ts";
import { formatBytes } from "~/i18n/formats.ts";
import { m } from "@slipstream/i18n";
import { PageHeader, TabLinks } from "~/ui/page.tsx";
import { LoadingScope, Sk } from "~/ui/skeleton.tsx";
import { shapes, useKept } from "~/api/shape-cache.ts";
import { type LibraryData } from "./queries.ts";
import { cn } from "~/ui/utils.ts";

/**
 * The free space in the Recordings header, quiet and admin only ("620 GB free"); the meter
 * lives in Settings › Storage. A fixed box, so the number arriving moves nothing.
 */
function FreeSpace({ shown }: { shown: boolean }) {
  const queries = useQueries();
  const keptSystem = useKept(shapes.system);
  const system = useQuery({
    ...queries.system(),
    placeholderData: (previous) => previous ?? keptSystem,
  });
  const storage = system.data?.storage[0];
  return (
    <LoadingScope
      as="span"
      loading={system.isPending}
      className={cn(
        "hidden w-40 text-right text-[13px] text-fg-3 tabular-nums sm:block short:hidden",
        !shown && "invisible",
      )}
      aria-hidden={shown ? undefined : true}
    >
      <Sk chars={12}>
        {storage === undefined
          ? ""
          : m.library_storage_free({ free: formatBytes(storage.freeBytes) })}
      </Sk>
    </LoadingScope>
  );
}

/**
 * The Recordings page head: title, the admin's storage meter, and the Library / Scheduled /
 * Problems tabs. The counts come from the one recordings list (SPEC §7.9).
 */
export function RecordingsHeader({ data }: { data: LibraryData }) {
  const scheduled = data.recordings.filter((entry) => entry.state === "scheduled").length;
  const problems = problemChains(data.recordings).length;
  return (
    <>
      <PageHeader
        title={m.nav_recordings()}
        actions={<FreeSpace shown={data.isAdmin || data.loading} />}
      />
      <TabLinks
        label={m.library_tabs_label()}
        tabs={[
          { label: m.recordings_tab_library(), to: "/recordings" },
          { label: m.library_title_scheduled(), to: "/recordings/scheduled", count: scheduled },
          {
            label: m.recordings_tab_problems(),
            to: "/recordings/problems",
            count: problems,
            ...(problems > 0 ? { tone: "warn" as const } : {}),
          },
        ]}
      />
    </>
  );
}
