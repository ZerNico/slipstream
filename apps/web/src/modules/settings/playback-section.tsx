import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { PlaybackSettings } from "@slipstream/api";
import { type QualityChoice, qualityChoices } from "@slipstream/domain";
import { shapes, useKept } from "~/api/shape-cache.ts";
import { DateTime } from "effect";
import { useQueries } from "~/api/hooks.ts";
import { m, qualityLabel } from "@slipstream/i18n";
import { LoadingScope } from "~/ui/skeleton.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { Select } from "~/ui/primitives/select.tsx";
import { ListPanel, ListRow, SettingsSection } from "./parts.tsx";
import { useSavePlaybackSettings } from "~/api/mutations.ts";
import { SectionProblem } from "./section-problem.tsx";
import { useAutosave } from "./use-autosave.ts";

const placeholderPlayback: PlaybackSettings = {
  hardwareAcceleration: "auto",
  detected: {
    name: "Hardware encoder",
    ok: true,
    testedAt: DateTime.makeUnsafe(0),
    detail: "Hardware encoder details",
  },
  preference: "quality",
  maxConversions: 2,
  quality: { home: "original", away: "auto", mobile: "auto" },
};

/** One situation and the household's default quality there ("Automatic" picks by speed). */
function QualityRow({
  title,
  value,
  onChange,
}: {
  title: string;
  value: QualityChoice;
  onChange: (value: QualityChoice) => void;
}) {
  return (
    <ListRow
      stackOnPhone
      title={title}
      end={
        <Select
          aria-label={title}
          className="w-[13.5rem] max-w-full"
          value={value}
          options={qualityChoices.map((quality) => ({
            value: quality,
            label: qualityLabel(quality),
          }))}
          onChange={onChange}
        />
      }
    />
  );
}

/**
 * Settings › Default quality (the household's): hardware acceleration and the default quality
 * at home, away and on mobile data, for every device left on "Household default". A note says
 * each device can choose its own under This device. Changes save themselves.
 */
export function PlaybackSection() {
  const queries = useQueries();
  const settings = useQuery(queries.playbackSettings());
  const save = useSavePlaybackSettings();
  const draft = useAutosave(settings.data, (value, callbacks) => save.mutate(value, callbacks));
  // The last answer this browser saw, so the skeleton has the real shape (detail line or not).
  const kept = useKept(shapes.playbackSettings);

  if (settings.isError) return <SectionProblem error={settings.error} />;
  const value = draft.value ?? kept ?? placeholderPlayback;
  const loading = settings.isPending;
  const detected = value.detected;
  const set = (patch: Partial<PlaybackSettings>) => draft.change({ ...value, ...patch });

  return (
    <LoadingScope loading={loading}>
      <SettingsSection title={m.settings_section_default_quality()}>
        <ListPanel>
          <ListRow
            stackOnPhone
            title={m.settings_hardware()}
            end={
              <Select
                aria-label={m.settings_hardware()}
                className="w-[13.5rem] max-w-full"
                value={value.hardwareAcceleration}
                disabled={loading}
                options={[
                  {
                    value: "auto",
                    label:
                      detected === undefined || !detected.ok
                        ? m.settings_hardware_auto()
                        : m.playback_auto_with({ name: detected.name }),
                  },
                  { value: "off", label: m.playback_software() },
                ]}
                onChange={(hardwareAcceleration) => set({ hardwareAcceleration })}
              />
            }
          />
        </ListPanel>
      </SettingsSection>
      <SettingsSection title={m.settings_quality_title()}>
        <ListPanel>
          <QualityRow
            title={m.settings_at_home()}
            value={value.quality.home}
            onChange={(home) => set({ quality: { ...value.quality, home } })}
          />
          <QualityRow
            title={m.settings_away()}
            value={value.quality.away}
            onChange={(away) => set({ quality: { ...value.quality, away } })}
          />
          <QualityRow
            title={m.settings_mobile()}
            value={value.quality.mobile}
            onChange={(mobile) => set({ quality: { ...value.quality, mobile } })}
          />
        </ListPanel>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="min-w-0 flex-1 basis-64 text-meta text-fg-2">
            {m.settings_device_quality_note()}
          </p>
          <Button
            size="sm"
            variant="ghost"
            nativeButton={false}
            render={<Link to="/settings/$section" params={{ section: "device" }} />}
          >
            {m.settings_device_quality_link()}
          </Button>
        </div>
      </SettingsSection>
    </LoadingScope>
  );
}
