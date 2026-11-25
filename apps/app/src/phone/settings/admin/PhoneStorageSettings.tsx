import type { StorageUsage } from "@slipstream/api";
import { storageParts, storageShare } from "@slipstream/domain";
import { formatters, m } from "@slipstream/i18n";
import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { readProblem } from "../../../api/failure.ts";
import { AdminOnly, PageStatus } from "../../ui/PageStatus.tsx";
import { useApiQueries } from "../../../data/hooks.ts";
import { useTheme } from "../../../theme/theme.ts";
import { METER_EM, ROW_TWO_LINES_EM } from "./metrics.ts";
import { Group, Row, SettingsPage, SettingsSkeleton } from "./parts.tsx";
import { storageShape } from "./shapes.ts";

/**
 * The disk: recordings, pause-and-rewind and other files as parts of one bar, with the totals,
 * so bar, legend and heading add up (the web's meter).
 */
const Meter = ({ storage }: { readonly storage: StorageUsage }) => {
  const { colors, em, fonts } = useTheme();
  const parts = storageParts(storage);
  const size = formatters().size;
  const segment = (bytes: number, color: string) => (
    <View
      style={{
        height: "100%",
        width: `${storageShare(bytes, storage.totalBytes) * 100}%`,
        backgroundColor: color,
      }}
    />
  );
  return (
    <View
      style={{
        height: METER_EM * em,
        justifyContent: "center",
        gap: 0.55 * em,
        paddingHorizontal: em,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 0.8 * em }}>
        <Text style={{ fontFamily: fonts.fUi, fontSize: 0.9 * em, color: colors.fg2 }}>
          {m.settings_section_storage()}
        </Text>
        <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: 0.9 * em, color: colors.fg }}>
          {m.storage_used_of({ used: size(parts.used), total: size(storage.totalBytes) })}
        </Text>
      </View>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={m.storage_meter({
          usedBytes: storage.recordingsBytes,
          totalBytes: storage.totalBytes,
          bufferBytes: storage.bufferBytes,
        })}
        style={{
          flexDirection: "row",
          height: 0.5 * em,
          borderRadius: 0.25 * em,
          overflow: "hidden",
          backgroundColor: colors.tlTrack,
        }}
      >
        {segment(parts.recordings, colors.fg3)}
        {segment(parts.buffer, colors.brand)}
        {segment(parts.other, colors.borderStrong)}
      </View>
      <Text style={{ fontFamily: fonts.fUi, fontSize: 0.85 * em, color: colors.fg2 }}>
        {m.storage_summary({
          recordings: size(storage.recordingsBytes),
          free: size(storage.freeBytes),
        })}
      </Text>
    </View>
  );
};

/** Settings › Storage on a phone: the disk, the space kept free and where recordings live. */
const StoragePage = () => {
  const { colors, em, fonts } = useTheme();
  const title = m.settings_section_storage();
  const queries = useApiQueries();
  const system = useQuery(queries.system());
  if (system.isError) {
    return (
      <PageStatus
        heading={title}
        title={readProblem(system.error)}
        onRetry={() => void system.refetch()}
      />
    );
  }
  const storage = system.data?.storage[0];
  return (
    <SettingsPage title={title}>
      {system.isPending || storage === undefined ? (
        <SettingsSkeleton groups={storageShape} />
      ) : (
        <Group>
          <Meter storage={storage} />
          <Row
            title={m.storage_floor_label()}
            end={
              <Text style={{ fontFamily: fonts.fUi, fontSize: 0.92 * em, color: colors.fg2 }}>
                {formatters().size(storage.freeSpaceFloorBytes)}
              </Text>
            }
          />
          <View
            style={{
              minHeight: ROW_TWO_LINES_EM * em,
              justifyContent: "center",
              paddingHorizontal: em,
              paddingVertical: 0.6 * em,
              gap: 0.15 * em,
            }}
          >
            <Text style={{ fontFamily: fonts.fUiSemiBold, fontSize: 0.98 * em, color: colors.fg }}>
              {m.storage_location_label()}
            </Text>
            <Text style={{ fontFamily: fonts.fMono, fontSize: 0.85 * em, color: colors.fg2 }}>
              {storage.path}
            </Text>
          </View>
        </Group>
      )}
    </SettingsPage>
  );
};

/** Settings › Storage, for admins. */
export const PhoneStorageSettings = () => (
  <AdminOnly heading={m.settings_section_storage()}>
    <StoragePage />
  </AdminOnly>
);
