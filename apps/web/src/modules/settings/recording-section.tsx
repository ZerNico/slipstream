import { useQuery } from "@tanstack/react-query";
import type { RecordingSettings } from "@slipstream/api";
import {
  addOverride,
  type Channel,
  channelsWithoutOverride,
  type ExtraTimeDefaults,
  type ExtraTimeOverride,
  type Padding,
  removeOverride,
  setGlobalPadding,
  setOverridePadding,
} from "@slipstream/domain";
import { useRef, useState } from "react";
import { useQueries } from "~/api/hooks.ts";
import { problemOf } from "~/api/errors.ts";
import { m } from "@slipstream/i18n";
import { Field, Segmented } from "~/ui/controls.tsx";
import { Dialog } from "~/ui/dialog.tsx";
import { Icon } from "~/ui/icon.tsx";
import { AddIcon, DeleteIcon } from "~/ui/icons.ts";
import { useOverlay, useOverlayBinding } from "~/ui/overlay/use-overlay.tsx";
import { Button, IconButton } from "~/ui/primitives/button.tsx";
import { Input } from "~/ui/primitives/input.tsx";
import { LoadingScope, Sk } from "~/ui/skeleton.tsx";
import { rememberedList } from "~/ui/skeleton-state.ts";
import { Select } from "~/ui/primitives/select.tsx";
import { MinutesSelect } from "~/ui/minutes-select.tsx";
import { LiveSection } from "./live-section.tsx";
import { ListPanel, ListRow, SettingsSection } from "./parts.tsx";
import { useSaveArtworkSettings, useSaveRecordingSettings } from "./queries.ts";
import { SectionProblem } from "./section-problem.tsx";
import { useAutosave } from "./use-autosave.ts";

/** Settings of the usual shape while loading, with as many exceptions as last time. */
const placeholderSettings = (known: RecordingSettings | undefined): RecordingSettings => ({
  extraTime: {
    padding: { beforeMinutes: 2, afterMinutes: 10 },
    overrides: rememberedList("settings.overrides", known?.extraTime.overrides, 0, (index) => ({
      _tag: "Category" as const,
      category: `Category ${index}`,
      padding: { beforeMinutes: 5, afterMinutes: 60 },
    })),
  },
  artworkOrder: ["guide", "frame"],
});

function PaddingSelects({
  name,
  padding,
  disabled,
  onChange,
}: {
  name: string;
  padding: Padding;
  disabled: boolean;
  onChange: (padding: Padding) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <MinutesSelect
        label={`${m.padding_before()}, ${name}`}
        value={padding.beforeMinutes}
        side="early"
        text={(minutes) => m.rec_early_value({ minutes })}
        disabled={disabled}
        onChange={(beforeMinutes) => onChange({ ...padding, beforeMinutes })}
      />
      <MinutesSelect
        label={`${m.padding_after()}, ${name}`}
        value={padding.afterMinutes}
        side="late"
        text={(minutes) => m.rec_late_value({ minutes })}
        disabled={disabled}
        onChange={(afterMinutes) => onChange({ ...padding, afterMinutes })}
      />
    </div>
  );
}

const overrideName = (override: ExtraTimeOverride, channels: readonly Channel[]): string =>
  override._tag === "Channel"
    ? (channels.find((channel) => channel.id === override.channelId)?.name ?? override.channelId)
    : override.category;

/** "Add exception": a channel or a guide category, starting from the default. */
function AddOverrideDialog({
  defaults,
  channels,
  onAdd,
}: {
  defaults: ExtraTimeDefaults;
  channels: readonly Channel[];
  onAdd: (next: ExtraTimeDefaults) => void;
}) {
  const binding = useOverlayBinding("dlg", "override");
  const overlay = useOverlay();
  const free = channelsWithoutOverride(
    defaults,
    channels.filter((channel) => !channel.hidden),
  );
  const [kind, setKind] = useState<"channel" | "category">("channel");
  const [channelId, setChannelId] = useState<string>("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState<string | undefined>();
  const firstField = useRef<HTMLButtonElement | null>(null);
  const picked = free.find((channel) => channel.id === channelId) ?? free[0];

  const submit = () => {
    const override: ExtraTimeOverride | undefined =
      kind === "channel"
        ? picked === undefined
          ? undefined
          : { _tag: "Channel", channelId: picked.id, padding: defaults.padding }
        : category.trim() === ""
          ? undefined
          : { _tag: "Category", category: category.trim(), padding: defaults.padding };
    if (override === undefined) {
      setError(
        kind === "channel" ? m.rec_override_no_channel() : m.rec_override_category_missing(),
      );
      return;
    }
    const next = addOverride(defaults, override);
    if (next === "duplicate") {
      setError(m.rec_override_duplicate());
      return;
    }
    onAdd(next);
    setCategory("");
    setError(undefined);
    void overlay.close();
  };

  return (
    <Dialog
      open={binding.open}
      onOpenChange={binding.onOpenChange}
      label={m.rec_override_add()}
      showTitle
      size="sm"
      keyboardFocus={firstField}
      footer={
        <>
          <Button variant="ghost" onClick={() => void overlay.close()}>
            {m.action_cancel()}
          </Button>
          <Button variant="primary" type="submit" form="override-form">
            {m.rec_override_confirm()}
          </Button>
        </>
      }
    >
      <form
        id="override-form"
        className="grid gap-4 p-5.5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Segmented
          label={m.rec_override_kind()}
          value={kind}
          onChange={(next) => {
            setKind(next);
            setError(undefined);
          }}
          segments={[
            { value: "channel", label: m.rec_kind_channel() },
            { value: "category", label: m.rec_kind_category() },
          ]}
        />
        {kind === "channel" ? (
          <Field
            label={m.rec_kind_channel()}
            reserve
            htmlFor="override-channel"
            {...(error === undefined ? {} : { error })}
          >
            <Select
              id="override-channel"
              value={picked?.id ?? ""}
              disabled={free.length === 0}
              options={free.map((channel) => ({
                value: channel.id as string,
                label: channel.name,
              }))}
              onChange={(value) => setChannelId(value)}
            />
          </Field>
        ) : (
          <Field
            label={m.rec_kind_category()}
            htmlFor="override-category"
            {...(error === undefined ? {} : { error })}
          >
            <Input
              id="override-category"
              value={category}
              placeholder={m.rec_override_category_placeholder()}
              aria-invalid={error === undefined ? undefined : true}
              onChange={(event) => {
                setCategory(event.target.value);
                setError(undefined);
              }}
            />
          </Field>
        )}
      </form>
    </Dialog>
  );
}

/**
 * Pictures from TMDB (admins): a key connects it, and from then on films and series without a
 * guide picture get one. The key is never shown again; Disconnect removes it. TMDB asks for
 * the attribution line under it.
 */
function PicturesSection() {
  const queries = useQueries();
  const me = useQuery(queries.me());
  const artwork = useQuery(queries.artworkSettings());
  const save = useSaveArtworkSettings();
  const [key, setKey] = useState("");
  const [problem, setProblem] = useState<string | undefined>(undefined);
  if (me.data?.role !== "admin" || artwork.isError) return null;
  const connected = artwork.data?.tmdb === true;
  const submit = (next: string | null) => {
    setProblem(undefined);
    save.mutate(next, {
      onSuccess: () => setKey(""),
      onError: (error) => {
        const answer = problemOf(error);
        const code = answer._tag === "InvalidInput" ? answer.problems[0]?.code : undefined;
        setProblem(code === "invalidKey" ? m.rec_tmdb_invalid() : m.rec_tmdb_unreachable());
      },
    });
  };
  return (
    <SettingsSection title={m.rec_pictures_title()}>
      <ListPanel>
        <ListRow
          stackOnPhone
          className="min-h-18"
          title={m.rec_tmdb()}
          sub={
            <Sk>
              {connected ? (
                m.rec_tmdb_connected()
              ) : (
                <a
                  href="https://www.themoviedb.org/settings/api"
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-line-2 underline-offset-3 fine:hover:text-fg coarse:inline-flex coarse:min-h-11 coarse:items-center"
                >
                  {m.rec_tmdb_get_key()}
                </a>
              )}
            </Sk>
          }
          extra={
            problem === undefined ? null : (
              <p className="mt-1 text-meta text-live-fg" role="alert">
                {problem}
              </p>
            )
          }
          end={
            connected ? (
              <Button size="sm" variant="ghost" busy={save.isPending} onClick={() => submit(null)}>
                {m.rec_tmdb_remove()}
              </Button>
            ) : (
              <form
                className="flex items-center gap-2 max-sm:w-full"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (key.trim() !== "") submit(key.trim());
                }}
              >
                <Input
                  type="password"
                  autoComplete="off"
                  aria-label={m.rec_tmdb_key()}
                  placeholder={m.rec_tmdb_key()}
                  value={key}
                  disabled={artwork.isPending}
                  onChange={(event) => setKey(event.target.value)}
                  className="w-56 max-sm:flex-1"
                />
                <Button
                  size="sm"
                  type="submit"
                  busy={save.isPending}
                  disabled={key.trim() === "" || artwork.isPending}
                >
                  {m.rec_tmdb_connect()}
                </Button>
              </form>
            )
          }
        />
      </ListPanel>
      <p className="mt-2 px-1 text-meta text-fg-3">{m.rec_tmdb_attribution()}</p>
    </SettingsSection>
  );
}

/**
 * Settings › Recording: how early to start and how late to end, then exceptions per channel or
 * guide category, then what live TV keeps after its viewers leave. Changes save themselves and
 * never rewrite existing series recordings.
 */
export function RecordingSection() {
  const queries = useQueries();
  const overlay = useOverlay();
  const settings = useQuery(queries.recordingSettings());
  const channels = useQuery(queries.channels());
  const save = useSaveRecordingSettings();
  const draft = useAutosave(settings.data, (value, callbacks) => save.mutate(value, callbacks));

  if (settings.isError) return <SectionProblem error={settings.error} />;
  const loading = settings.isPending || channels.isPending;
  // Always worked out, so the number of exceptions is remembered for the next load.
  const placeholder = placeholderSettings(settings.data);
  const value = draft.value ?? placeholder;
  const defaults = value.extraTime;
  const channelList = channels.data ?? [];
  const setDefaults = (extraTime: ExtraTimeDefaults) => draft.change({ ...value, extraTime });
  const setGlobal = (padding: Padding) => setDefaults(setGlobalPadding(defaults, padding));

  return (
    <LoadingScope loading={loading}>
      <SettingsSection title={m.series_section_extra()}>
        <ListPanel>
          <ListRow
            title={m.padding_before()}
            end={
              <MinutesSelect
                label={m.padding_before()}
                value={defaults.padding.beforeMinutes}
                side="early"
                text={(minutes) => m.rec_minutes({ minutes })}
                disabled={loading}
                onChange={(beforeMinutes) => setGlobal({ ...defaults.padding, beforeMinutes })}
              />
            }
          />
          <ListRow
            title={m.padding_after()}
            end={
              <MinutesSelect
                label={m.padding_after()}
                value={defaults.padding.afterMinutes}
                side="late"
                text={(minutes) => m.rec_minutes({ minutes })}
                disabled={loading}
                onChange={(afterMinutes) => setGlobal({ ...defaults.padding, afterMinutes })}
              />
            }
          />
        </ListPanel>
      </SettingsSection>
      <SettingsSection
        title={m.rec_overrides_title()}
        action={
          <Button
            size="sm"
            variant="ghost"
            icon={<Icon icon={AddIcon} />}
            disabled={loading}
            onClick={() => overlay.open({ kind: "dlg", name: "override" })}
          >
            {m.rec_override_add()}
          </Button>
        }
      >
        {defaults.overrides.length === 0 ? (
          <p className="panel px-4.5 py-4 text-[14px] text-fg-2">
            <Sk>{m.rec_overrides_empty()}</Sk>
          </p>
        ) : (
          <ListPanel>
            {defaults.overrides.map((override, index) => {
              const name = overrideName(override, channelList);
              return (
                <ListRow
                  key={override._tag === "Channel" ? override.channelId : `c:${override.category}`}
                  stackOnPhone
                  title={<Sk>{name}</Sk>}
                  sub={
                    <Sk>
                      {override._tag === "Channel" ? m.rec_kind_channel() : m.rec_kind_category()}
                    </Sk>
                  }
                  end={
                    <div className="flex items-center gap-2">
                      <PaddingSelects
                        name={name}
                        padding={override.padding}
                        disabled={loading}
                        onChange={(padding) =>
                          setDefaults(setOverridePadding(defaults, index, padding))
                        }
                      />
                      <IconButton
                        size="sm"
                        label={m.rec_override_remove({ name })}
                        disabled={loading}
                        onClick={() => setDefaults(removeOverride(defaults, index))}
                      >
                        <Icon icon={DeleteIcon} size={16} />
                      </IconButton>
                    </div>
                  }
                />
              );
            })}
          </ListPanel>
        )}
      </SettingsSection>
      <LiveSection />
      <PicturesSection />
      {loading ? null : (
        <AddOverrideDialog defaults={defaults} channels={channelList} onAdd={setDefaults} />
      )}
    </LoadingScope>
  );
}
