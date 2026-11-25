import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { passwordMinLength } from "@slipstream/api";
import {
  type Channel,
  type ChannelId,
  channelMark,
  type SourceDraft,
  type SourceId,
  sourceInput,
  hasStreamsToPick,
} from "@slipstream/domain";
import { useState } from "react";
import { useApi, useQueries } from "~/api/hooks.ts";
import { useCreateSource, useRefreshSource, useSetup, useTestSource } from "~/api/mutations.ts";
import { m } from "@slipstream/i18n";
import { problemOf } from "~/api/errors.ts";
import { problemTitle } from "~/api/problem-title.ts";
import { ResultNote } from "~/ui/result-note.tsx";
import { SourceTestNote, StreamLimitField } from "~/modules/settings/source-form.tsx";
import { groupsQuery, useAddStreams } from "~/modules/settings/stream-picker/api.ts";
import { addLabel } from "~/modules/settings/stream-picker/picker-text.ts";
import { PickerCount, StreamPickerList } from "~/modules/settings/stream-picker/stream-picker.tsx";
import { useStreamPicker } from "~/modules/settings/stream-picker/use-stream-picker.ts";
import { sourceErrors, sourceFailureText } from "~/modules/settings/source-text.ts";
import { ChannelLogo } from "~/ui/artwork/artwork.tsx";
import { Field } from "~/ui/controls.tsx";
import { Icon } from "~/ui/icon.tsx";
import { CheckIcon, ForwardIcon } from "~/ui/icons.ts";
import { Button } from "~/ui/primitives/button.tsx";
import { Checkbox } from "~/ui/primitives/checkbox.tsx";
import { Input } from "~/ui/primitives/input.tsx";
import { LoadingScope, Sk } from "~/ui/skeleton.tsx";
import { placeholderList } from "~/ui/skeleton-state.ts";
import { cn } from "~/ui/utils.ts";
import { AuthHeading, AuthLayout } from "./auth-layout.tsx";
import { useHideChannels } from "./queries.ts";
import { passwordHint, passwordStrength } from "./auth-text.ts";

const stepCount = 4;

/** The four bars over the form: done and current steps in amber. */
function Steps({ current }: { current: number }) {
  return (
    <div
      className="flex gap-1.5"
      role="img"
      aria-label={m.setup_step({ step: current + 1, count: stepCount })}
    >
      {Array.from({ length: stepCount }, (_, index) => (
        <i
          key={index}
          className={cn("h-1 flex-1 rounded-[2px]", index <= current ? "bg-brand" : "bg-line-2")}
        />
      ))}
    </div>
  );
}

/** The password meter: four bars that fill green as the password gets stronger. */
function Strength({ password }: { password: string }) {
  const strength = passwordStrength(password);
  return (
    <div className="flex gap-1.5" aria-hidden="true">
      {[1, 2, 3, 4].map((bar) => (
        <i
          key={bar}
          className={cn(
            "h-1 flex-1 rounded-[2px]",
            bar <= strength ? (strength <= 2 ? "bg-warn" : "bg-ok") : "bg-line-2",
          )}
        />
      ))}
    </div>
  );
}

/** Step 1: the admin account. There are no default passwords. */
function AccountStep({ onDone }: { onDone: () => void }) {
  const setup = useSetup();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);
  const errors = {
    name: name.trim() === "" ? m.setup_name_missing() : undefined,
    username: username.trim() === "" ? m.setup_username_missing() : undefined,
    password: password.length < passwordMinLength ? passwordHint(password) : undefined,
  };
  const valid = Object.values(errors).every((error) => error === undefined);
  const shown = (error: string | undefined) => (touched && error !== undefined ? { error } : {});
  return (
    <form
      className="grid gap-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (!valid) return;
        setup.mutate(
          { displayName: name.trim(), username: username.trim(), password },
          { onSuccess: onDone },
        );
      }}
    >
      <AuthHeading
        eyebrow={m.setup_step({ step: 1, count: stepCount })}
        title={m.setup_account_title()}
      />
      <Field reserve label={m.setup_display_name()} htmlFor="setup-name" {...shown(errors.name)}>
        <Input
          id="setup-name"
          autoComplete="name"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Field
        reserve
        label={m.signin_username()}
        htmlFor="setup-username"
        {...shown(errors.username)}
      >
        <Input
          id="setup-username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </Field>
      <div className="field">
        <label className="field-label" htmlFor="setup-password">
          {m.signin_password()}
        </label>
        <Input
          id="setup-password"
          type="password"
          autoComplete="new-password"
          value={password}
          aria-invalid={touched && errors.password !== undefined ? true : undefined}
          aria-describedby="setup-password-hint"
          onChange={(event) => setPassword(event.target.value)}
        />
        <Strength password={password} />
        <span
          id="setup-password-hint"
          className={touched && errors.password !== undefined ? "field-error" : "field-hint"}
        >
          {passwordHint(password)}
        </span>
      </div>
      {setup.isError ? (
        <ResultNote tone="error">
          {problemOf(setup.error)._tag === "AlreadySetUp"
            ? m.setup_done_elsewhere()
            : problemTitle(setup.error)}
        </ResultNote>
      ) : null}
      <Button
        variant="primary"
        size="lg"
        type="submit"
        busy={setup.isPending}
        icon={<Icon icon={ForwardIcon} />}
      >
        {m.action_continue()}
      </Button>
    </form>
  );
}

/** Step 2: the first source; testing it first is offered, not required. */
function SourceStep({
  onDone,
  onSkip,
}: {
  onDone: (sourceId: SourceId) => void;
  onSkip: () => void;
}) {
  const test = useTestSource();
  const create = useCreateSource();
  const refresh = useRefreshSource();
  const [draft, setDraft] = useState<SourceDraft>({
    name: m.setup_source_name(),
    playlist: "",
    guide: "",
    limit: "",
    kept: "",
  });
  const [touched, setTouched] = useState(false);
  const errors = sourceErrors(draft, { playlist: false });
  const valid = Object.keys(errors).length === 0;
  const set = (patch: Partial<SourceDraft>) => {
    setDraft((before) => ({ ...before, ...patch }));
    test.reset();
  };
  const shown = (error: string | undefined) => (touched && error !== undefined ? { error } : {});
  const saving = create.isPending || refresh.isPending;
  return (
    <form
      className="grid gap-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (!valid) return;
        create.mutate(sourceInput(draft), {
          onSuccess: (source) => refresh.mutate(source.id, { onSettled: () => onDone(source.id) }),
        });
      }}
    >
      <AuthHeading
        eyebrow={m.setup_step({ step: 2, count: stepCount })}
        title={m.setup_source_title()}
      />
      <Field
        reserve
        label={m.source_playlist_url()}
        htmlFor="setup-playlist"
        {...shown(errors.playlist)}
      >
        <Input
          id="setup-playlist"
          type="url"
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          placeholder={m.source_playlist_placeholder()}
          value={draft.playlist}
          onChange={(event) => set({ playlist: event.target.value })}
        />
      </Field>
      <Field reserve label={m.source_guide_url()} htmlFor="setup-guide" {...shown(errors.guide)}>
        <Input
          id="setup-guide"
          type="url"
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={m.source_guide_placeholder()}
          value={draft.guide}
          onChange={(event) => set({ guide: event.target.value })}
        />
      </Field>
      <StreamLimitField id="setup-limit" value={draft.limit} onChange={(limit) => set({ limit })} />
      <SourceTestNote test={test} />
      {create.isError ? (
        <ResultNote tone="error">{sourceFailureText(create.error)}</ResultNote>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="lg"
          icon={<Icon icon={CheckIcon} />}
          busy={test.isPending}
          onClick={() => {
            setTouched(true);
            if (valid) test.mutate(sourceInput(draft));
          }}
        >
          {m.source_test()}
        </Button>
        <Button
          variant="primary"
          size="lg"
          type="submit"
          className="flex-1"
          busy={saving}
          icon={<Icon icon={ForwardIcon} />}
        >
          {m.action_continue()}
        </Button>
      </div>
      <Button variant="ghost" className="justify-self-start" onClick={onSkip}>
        {m.setup_skip_source()}
      </Button>
    </form>
  );
}

/** A channel row's place while the lineup loads: a name and a guide note of the usual length. */
const placeholderChannel = (index: number): Channel => ({
  id: `placeholder-${index}` as ChannelId,
  // Never read: a transparent bar of a usual name's length.
  name: "0".repeat(12),
  guideChannelId: "placeholder",
  favourite: false,
  hidden: false,
});

/**
 * Step 3 for a big playlist (its streams wait to be picked): the stream picker with the groups
 * in the reader's language ticked, and Add.
 */
function PickStep({ sourceId, onDone }: { sourceId: SourceId; onDone: () => void }) {
  const picker = useStreamPicker(sourceId);
  const add = useAddStreams();
  return (
    <div className="grid gap-5">
      <AuthHeading
        eyebrow={m.setup_step({ step: 3, count: stepCount })}
        title={m.setup_channels_title()}
        text={m.picker_setup_text()}
      />
      <StreamPickerList picker={picker} className="h-[360px]" />
      {add.isError ? <ResultNote tone="error">{problemTitle(add.error)}</ResultNote> : null}
      <div className="flex justify-end">
        <PickerCount picker={picker} />
      </div>
      <Button
        variant="primary"
        size="lg"
        busy={add.isPending}
        disabled={picker.streamsLoading}
        icon={<Icon icon={ForwardIcon} />}
        onClick={() =>
          add.mutate({ id: sourceId, streamIds: picker.pickedIds() }, { onSuccess: onDone })
        }
      >
        {addLabel(picker)}
      </Button>
    </div>
  );
}

/**
 * Step 3: which channels show up. A small playlist's streams are channels already: everything
 * starts picked, hidden ones can come back later. A big one's wait in the picker.
 */
function ChannelsStep({ sourceId, onDone }: { sourceId: SourceId; onDone: () => void }) {
  const api = useApi();
  const groups = useQuery(groupsQuery(api, sourceId));
  // Decided once, from the first answer: adding streams changes the counts, and the picker has
  // to stay until its Add is done.
  const [big, setBig] = useState<boolean | undefined>(undefined);
  if (big === undefined && groups.data !== undefined) {
    setBig(hasStreamsToPick(groups.data));
  }
  return big === true ? (
    <PickStep sourceId={sourceId} onDone={onDone} />
  ) : (
    <AddedChannelsStep loadingGroups={groups.isPending} onDone={onDone} />
  );
}

/** Step 3 for a small playlist: its channels, everything picked. */
function AddedChannelsStep({
  loadingGroups,
  onDone,
}: {
  loadingGroups: boolean;
  onDone: () => void;
}) {
  const queries = useQueries();
  const channels = useQuery(queries.channels());
  const hide = useHideChannels();
  const [off, setOff] = useState<ReadonlySet<ChannelId>>(new Set());
  const loading = channels.isPending || loadingGroups;
  // While loading, enough placeholder rows to fill the list's 300 px, so it keeps its height.
  const list = placeholderList(
    channels.data?.filter((channel) => !channel.hidden),
    7,
    placeholderChannel,
  );
  const picked = list.filter((channel) => !off.has(channel.id)).length;
  return (
    <LoadingScope loading={loading} className="grid gap-5">
      <AuthHeading
        eyebrow={m.setup_step({ step: 3, count: stepCount })}
        title={m.setup_channels_title()}
        text={
          <Sk chars={36}>{loading ? "" : m.setup_channels_text({ picked, total: list.length })}</Sk>
        }
      />
      <div
        role="group"
        aria-label={m.channels_heading()}
        className="grid max-h-[300px] gap-0.5 overflow-auto rounded-md p-1.5 shadow-[inset_0_0_0_1px_var(--line-2)]"
      >
        {list.map((channel) => (
          <label
            key={channel.id}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-sm px-2 py-1.5 text-[14px] font-[550] fine:hover:bg-hover"
          >
            <span className="sk-hide flex flex-none">
              <Checkbox
                checked={!off.has(channel.id)}
                onCheckedChange={(checked) =>
                  setOff((before) => {
                    const next = new Set(before);
                    if (checked) next.delete(channel.id);
                    else next.add(channel.id);
                    return next;
                  })
                }
              />
            </span>
            <span className="sk-hide flex flex-none">
              <ChannelLogo mark={channelMark(channel.name)} size="sm" />
            </span>
            <span className="min-w-0 flex-1 truncate">
              <Sk>{channel.name}</Sk>
            </span>
            <span className="flex-none text-caption font-normal text-fg-3">
              <Sk>
                {channel.guideChannelId === undefined ? m.guide_no_data() : m.setup_has_guide()}
              </Sk>
            </span>
          </label>
        ))}
        {list.length === 0 ? (
          <p className="p-3 text-[14px] text-fg-2">{m.channels_empty()}</p>
        ) : null}
      </div>
      {hide.isError || (hide.data ?? 0) > 0 ? (
        <ResultNote tone="error">{m.state_not_saved()}</ResultNote>
      ) : null}
      <Button
        variant="primary"
        size="lg"
        busy={hide.isPending}
        disabled={loading}
        icon={<Icon icon={ForwardIcon} />}
        onClick={() =>
          // Every hide is asked; one that failed keeps the step open, to try again.
          hide.mutate([...off], { onSuccess: (failed) => (failed === 0 ? onDone() : undefined) })
        }
      >
        {m.setup_channels_continue({ count: picked })}
      </Button>
    </LoadingScope>
  );
}

/** Step 4: done, with the way in and the first series recording. */
function DoneStep() {
  return (
    <div className="grid gap-5">
      <div className="grid justify-items-center gap-3.5 text-center">
        <span className="grid size-18 place-items-center rounded-full bg-ok-soft text-ok-fg">
          <Icon icon={CheckIcon} size={24} />
        </span>
        <h1 className="type-h1">{m.setup_done_title()}</h1>
      </div>
      <Button variant="primary" size="lg" nativeButton={false} render={<Link to="/" replace />}>
        {m.setup_open()}
      </Button>
      <Button size="lg" nativeButton={false} render={<Link to="/series/new" />}>
        {m.setup_first_series()}
      </Button>
    </div>
  );
}

/**
 * First-run setup (SPEC §8.8): the admin account, the first source (a test is offered),
 * the channels, done. The account is created at the end of step 1, so the rest runs signed in.
 */
export function SetupPage() {
  const [step, setStep] = useState(0);
  const [sourceId, setSourceId] = useState<SourceId | undefined>(undefined);
  const navigate = useNavigate();
  return (
    <AuthLayout>
      <Steps current={step} />
      {step === 0 ? <AccountStep onDone={() => setStep(1)} /> : null}
      {step === 1 ? (
        <SourceStep
          onDone={(id) => {
            setSourceId(id);
            setStep(2);
          }}
          onSkip={() => void navigate({ to: "/", replace: true })}
        />
      ) : null}
      {step === 2 && sourceId !== undefined ? (
        <ChannelsStep sourceId={sourceId} onDone={() => setStep(3)} />
      ) : null}
      {step === 3 ? <DoneStep /> : null}
    </AuthLayout>
  );
}
