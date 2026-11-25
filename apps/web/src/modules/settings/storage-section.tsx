import { useQuery } from "@tanstack/react-query";
import type { StorageUsage } from "@slipstream/api";
import { useQueries } from "~/api/hooks.ts";
import { shapes, useKept } from "~/api/shape-cache.ts";
import { formatBytes } from "~/i18n/formats.ts";
import { m } from "@slipstream/i18n";
import { LoadingScope, Sk } from "~/ui/skeleton.tsx";
import { storageParts } from "@slipstream/domain";
import { ListPanel, ListRow, SettingsSection } from "./parts.tsx";
import { SectionProblem } from "./section-problem.tsx";

const GB = 1e9;

const placeholderStorage: StorageUsage = {
  path: "/data",
  totalBytes: 2000 * GB,
  freeBytes: 1000 * GB,
  recordingsBytes: 900 * GB,
  bufferBytes: 100 * GB,
  freeSpaceFloorBytes: 50 * GB,
};

/**
 * The disk: recordings, pause-and-rewind and other files as parts of one bar, with the totals,
 * so bar, legend and heading add up.
 */
function Meter({ storage }: { storage: StorageUsage }) {
  const parts = storageParts(storage);
  const share = (bytes: number) =>
    `${Math.min(100, Math.max(0, (bytes / Math.max(1, storage.totalBytes)) * 100))}%`;
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="text-fg-2">{m.settings_section_storage()}</span>
        <b className="tabular-nums">
          <Sk>
            {m.storage_used_of({
              used: formatBytes(parts.used),
              total: formatBytes(storage.totalBytes),
            })}
          </Sk>
        </b>
      </div>
      <div
        className="sk-art flex h-2 overflow-hidden rounded-full bg-tl-track"
        role="img"
        aria-label={m.storage_meter({
          usedBytes: storage.recordingsBytes,
          totalBytes: storage.totalBytes,
          bufferBytes: storage.bufferBytes,
        })}
      >
        <span className="h-full bg-fg-3" style={{ width: share(parts.recordings) }} />
        <span className="h-full bg-brand" style={{ width: share(parts.buffer) }} />
        <span className="h-full bg-fg-4" style={{ width: share(parts.other) }} />
      </div>
      <p className="text-meta text-fg-2 tabular-nums">
        <Sk>
          {m.storage_summary({
            recordings: formatBytes(storage.recordingsBytes),
            free: formatBytes(storage.freeBytes),
          })}
        </Sk>
      </p>
    </div>
  );
}

/** Settings › Storage: the disk, the space kept free and where recordings live. */
export function StorageSection() {
  const queries = useQueries();
  const system = useQuery(queries.system());
  const kept = useKept(shapes.system);

  if (system.isError) return <SectionProblem error={system.error} />;
  const storage = (system.data ?? kept)?.storage[0] ?? placeholderStorage;

  return (
    <LoadingScope loading={system.isPending}>
      <SettingsSection title={m.settings_section_storage()}>
        <div className="panel p-5">
          <Meter storage={storage} />
        </div>
        <ListPanel>
          <ListRow
            title={m.storage_floor_label()}
            end={
              <span className="text-[14px] text-fg-2 tabular-nums">
                <Sk>{formatBytes(storage.freeSpaceFloorBytes)}</Sk>
              </span>
            }
          />
          <ListRow
            title={m.storage_location_label()}
            end={
              <code className="font-mono text-[13px] text-fg-2 [overflow-wrap:anywhere]">
                <Sk>{storage.path}</Sk>
              </code>
            }
          />
        </ListPanel>
      </SettingsSection>
    </LoadingScope>
  );
}
