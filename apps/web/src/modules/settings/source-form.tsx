import {
  addressField,
  type SourceDraft,
  sourceDraftOf,
  sourceEdit,
  sourceInput,
  type SourceView,
} from "@slipstream/domain";
import { type RefObject, useState } from "react";
import { useCreateSource, useTestSource, useUpdateSource } from "~/api/mutations.ts";
import { m } from "@slipstream/i18n";
import { Field } from "~/ui/controls.tsx";
import { Icon } from "~/ui/icon.tsx";
import { CheckIcon } from "~/ui/icons.ts";
import { Button } from "~/ui/primitives/button.tsx";
import { Input } from "~/ui/primitives/input.tsx";
import { Switch } from "~/ui/primitives/switch.tsx";
import { ResultNote } from "~/ui/result-note.tsx";
import { sourceErrors, sourceFailureText } from "./source-text.ts";

/**
 * Add or edit an M3U + XMLTV source (SPEC §8.7). "Test source" fetches both before anything is
 * saved, so a typo shows up here and not as a failed recording on Sunday. Addresses with
 * credentials are write-only: editing leaves them as stored unless something new is typed.
 */
export function SourceForm({
  source,
  formId,
  firstField,
  onDone,
}: {
  source: SourceView | undefined;
  formId: string;
  firstField?: RefObject<HTMLInputElement | null>;
  /** After a save; a new source comes with what was created. */
  onDone: (saved: { readonly name: string; readonly created?: SourceView }) => void;
}) {
  const playlistStored =
    source?.config._tag === "M3u" ? addressField(source.config.playlistUrl) : undefined;
  const [draft, setDraft] = useState<SourceDraft>(() => sourceDraftOf(source));
  const [touched, setTouched] = useState(false);
  const test = useTestSource();
  const create = useCreateSource();
  const update = useUpdateSource();
  const errors = sourceErrors(draft, { playlist: playlistStored?.writeOnly ?? false });
  const valid = Object.keys(errors).length === 0;
  const shown = (error: string | undefined) => (touched ? error : undefined);
  const set = (patch: Partial<SourceDraft>) => {
    setDraft((before) => ({ ...before, ...patch }));
    test.reset();
  };
  const saveError = create.error ?? update.error;

  return (
    <form
      id={formId}
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (!valid) return;
        const name = draft.name.trim();
        if (source === undefined) {
          create.mutate(sourceInput(draft), { onSuccess: (created) => onDone({ name, created }) });
        } else {
          update.mutate(
            { id: source.id, update: sourceEdit(source, draft) },
            { onSuccess: () => onDone({ name }) },
          );
        }
      }}
    >
      <Field
        reserve
        label={m.field_name()}
        htmlFor={`${formId}-name`}
        {...errorProp(shown(errors.name))}
      >
        <Input
          id={`${formId}-name`}
          ref={firstField}
          value={draft.name}
          autoComplete="off"
          aria-invalid={shown(errors.name) === undefined ? undefined : true}
          onChange={(event) => set({ name: event.target.value })}
        />
      </Field>
      <Field
        label={m.source_playlist_url()}
        reserve
        htmlFor={`${formId}-playlist`}
        {...(playlistStored?.writeOnly === true && source?.config._tag === "M3u"
          ? { hint: m.source_url_keep_hint({ url: source.config.playlistUrl.url }) }
          : {})}
        {...errorProp(shown(errors.playlist))}
      >
        <Input
          id={`${formId}-playlist`}
          type="url"
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          value={draft.playlist}
          placeholder={m.source_playlist_placeholder()}
          aria-invalid={shown(errors.playlist) === undefined ? undefined : true}
          onChange={(event) => set({ playlist: event.target.value })}
        />
      </Field>
      <Field
        label={m.source_guide_url()}
        reserve
        htmlFor={`${formId}-guide`}
        {...errorProp(shown(errors.guide))}
      >
        <Input
          id={`${formId}-guide`}
          type="url"
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          value={draft.guide}
          placeholder={m.source_guide_placeholder()}
          aria-invalid={shown(errors.guide) === undefined ? undefined : true}
          onChange={(event) => set({ guide: event.target.value })}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <StreamLimitField
          id={`${formId}-limit`}
          value={draft.limit}
          onChange={(limit) => set({ limit })}
        />
        <Field label={m.source_kept()} htmlFor={`${formId}-kept`}>
          <Input
            id={`${formId}-kept`}
            type="number"
            inputMode="numeric"
            min={0}
            value={draft.kept}
            onChange={(event) => set({ kept: event.target.value })}
          />
        </Field>
      </div>
      <AutoAddField
        id={`${formId}-auto-add`}
        checked={draft.autoAddNew ?? false}
        onChange={(autoAddNew) => set({ autoAddNew })}
      />
      {source === undefined ? (
        <div className="grid gap-3">
          <SourceTestNote test={test} />
          <Button
            size="sm"
            icon={<Icon icon={CheckIcon} size={16} />}
            className="justify-self-start"
            busy={test.isPending}
            onClick={() => {
              setTouched(true);
              if (valid) test.mutate(sourceInput(draft));
            }}
          >
            {m.source_test()}
          </Button>
        </div>
      ) : null}
      {saveError === null ? null : (
        <ResultNote tone="error">{sourceFailureText(saveError)}</ResultNote>
      )}
    </form>
  );
}

const errorProp = (error: string | undefined) => (error === undefined ? {} : { error });

/** How many streams the source allows at once; empty is no limit. */
export function StreamLimitField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={m.source_max_streams()} htmlFor={id}>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        value={value}
        placeholder={m.source_unlimited()}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

/** "Add new streams automatically": new streams of added groups become channels on refresh. */
function AutoAddField({
  id,
  checked,
  onChange,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-[14.5px] font-semibold" id={`${id}-label`}>
          {m.source_auto_add()}
        </div>
        <div className="text-meta text-fg-3" id={`${id}-hint`}>
          {m.source_auto_add_hint()}
        </div>
      </div>
      <Switch
        checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-hint`}
        onCheckedChange={onChange}
      />
    </div>
  );
}

/** What "Test source" found ("212 streams, …"), or why it failed. Nothing before a test. */
export function SourceTestNote({ test }: { test: ReturnType<typeof useTestSource> }) {
  if (test.isSuccess) {
    return (
      <ResultNote tone="ok">
        {m.source_test_result({
          streams: test.data.streams,
          programmes: test.data.programmes,
          unmapped: test.data.unmappedStreams,
        })}
      </ResultNote>
    );
  }
  return test.isError ? (
    <ResultNote tone="error">{sourceFailureText(test.error)}</ResultNote>
  ) : null;
}
