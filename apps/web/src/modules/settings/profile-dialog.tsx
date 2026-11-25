import {
  AvatarTone,
  type Channel,
  type Collection,
  type Profile,
  type Role,
  type User,
} from "@slipstream/domain";
import {
  accessFromTokens,
  type AccessToken,
  accessTokens,
  fullAccess,
  isPin,
  pinChange,
  pinInput,
  pinLength,
  type PinMode,
} from "@slipstream/domain";
import { useIsMutating } from "@tanstack/react-query";
import { type RefObject, useRef, useState } from "react";
import { m, toneLabel } from "@slipstream/i18n";
import { Field, Segmented } from "~/ui/controls.tsx";
import { Dialog } from "~/ui/dialog.tsx";
import { useOverlay, useOverlayBinding } from "~/ui/overlay/use-overlay.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { Input } from "~/ui/primitives/input.tsx";
import { Switch } from "~/ui/primitives/switch.tsx";
import { toast } from "~/ui/toast-manager.ts";
import { cn } from "~/ui/utils.ts";
import { AccessField } from "./access-field.tsx";
import { profileWriteKey } from "./write-keys.ts";
import { AccessOptions, RemoveConfirm } from "./access-options.tsx";
import { problemOf } from "~/api/errors.ts";
import { Avatar, AvatarSwatch } from "~/ui/avatar.tsx";
import { useCreateProfile, useRemoveProfile, useSetPin, useUpdateProfile } from "./queries.ts";

/** The tone picker: six round swatches as one radio group, 44 px each. */
export function TonePicker({
  name,
  value,
  onChange,
}: {
  name: string;
  value: AvatarTone;
  onChange: (tone: AvatarTone) => void;
}) {
  return (
    <div className="field">
      <span className="field-label" id="tone-label">
        {m.profile_picture()}
      </span>
      <div
        className="flex flex-wrap items-center gap-2"
        role="radiogroup"
        aria-labelledby="tone-label"
      >
        <Avatar name={name === "" ? "?" : name} tone={value} size={44} />
        <span className="mx-1 h-8 w-px bg-line" aria-hidden="true" />
        {AvatarTone.literals.map((tone) => (
          <button
            key={tone}
            type="button"
            role="radio"
            aria-checked={tone === value}
            aria-label={m.profile_tone({ tone: toneLabel(tone) })}
            className={cn(
              "grid size-11 place-items-center rounded-full",
              tone === value && "shadow-[inset_0_0_0_2px_var(--fg)]",
            )}
            onClick={() => onChange(tone)}
          >
            <AvatarSwatch tone={tone} />
          </button>
        ))}
      </div>
    </div>
  );
}

/** Everything a profile form needs from the page. */
interface ProfileFormProps {
  readonly profile: Profile | undefined;
  readonly me: User;
  readonly channels: readonly Channel[];
  readonly collections: readonly Collection[];
  readonly onDone: () => void;
  readonly nameRef: RefObject<HTMLInputElement | null>;
}

/**
 * The profile form: name, picture, PIN; for admins also the role and what the profile may see
 * and do. Adding and editing share it; the inline delete step lives at the bottom.
 */
function ProfileForm({ profile, me, channels, collections, onDone, nameRef }: ProfileFormProps) {
  const admin = me.role === "admin";
  const self = profile?.id === me.id;
  const create = useCreateProfile();
  const update = useUpdateProfile();
  const setPin = useSetPin();
  const remove = useRemoveProfile();
  const [name, setName] = useState(profile?.displayName ?? "");
  const [tone, setTone] = useState<AvatarTone>(profile?.avatarTone ?? "teal");
  const [role, setRole] = useState<Role>(profile?.role ?? "user");
  const [tokens, setTokens] = useState<AccessToken[]>(accessTokens(profile?.access ?? fullAccess));
  const [mayRecord, setMayRecord] = useState(profile?.access.mayRecord ?? true);
  const [streams, setStreams] = useState(profile?.access.maxStreams ?? 0);
  const hadPin = profile?.hasPin ?? false;
  const [pinMode, setPinMode] = useState<PinMode>("keep");
  const [pin, setPinValue] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [errors, setErrors] = useState<{ name?: string; pin?: string; form?: string }>({});
  const busy = create.isPending || update.isPending || setPin.isPending || remove.isPending;
  const pinOn = pinMode === "set" || (hadPin && pinMode === "keep");
  const editsAccess = admin && role !== "admin" && !self;

  const failed = (error: unknown) => {
    const problem = problemOf(error);
    if (problem._tag === "Conflict" && problem.code === "lastAdmin") {
      setErrors({ form: m.users_conflict_last_admin() });
    } else if (problem._tag === "InvalidCredentials") {
      setErrors({ pin: m.profile_pin_wrong() });
    } else if (problem._tag === "RateLimited") {
      setErrors({ pin: m.signin_rate_limited({ seconds: problem.retryAfterSeconds }) });
    } else {
      setErrors({ form: m.state_not_saved() });
    }
  };

  const submit = async () => {
    // One save at a time: Enter or a second click while it runs sends nothing more.
    if (busy) return;
    const trimmed = name.trim();
    const next: typeof errors = {};
    if (trimmed === "") next.name = m.profile_name_missing();
    if (pinMode === "set" && !isPin(pin)) next.pin = m.profile_pin_invalid();
    setErrors(next);
    if (next.name !== undefined || next.pin !== undefined) return;
    const access = editsAccess
      ? accessFromTokens(tokens, { mayRecord, maxStreams: streams === 0 ? undefined : streams })
      : undefined;
    try {
      if (profile === undefined) {
        await create.mutateAsync({
          displayName: trimmed,
          avatarTone: tone,
          role,
          ...(pinMode === "set" && isPin(pin) ? { pin } : {}),
          ...(access === undefined ? {} : { access }),
        });
      } else {
        await update.mutateAsync({
          id: profile.id,
          update: {
            displayName: trimmed,
            avatarTone: tone,
            ...(admin && !self && profile.kind === "household" ? { role } : {}),
            ...(access === undefined ? {} : { access }),
          },
        });
        const change = pinChange({ mode: pinMode, pin, currentPin, needsCurrent: self && hadPin });
        if (change !== undefined) await setPin.mutateAsync({ id: profile.id, ...change });
      }
      toast({ title: m.toast_saved_named({ name: trimmed }) });
      onDone();
    } catch (error) {
      failed(error);
    }
  };

  return (
    <form
      id="profile-form"
      className="grid gap-4 p-5.5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Field
        label={m.field_name()}
        reserve
        htmlFor="profile-name"
        {...(errors.name === undefined ? {} : { error: errors.name })}
      >
        <Input
          id="profile-name"
          ref={nameRef}
          value={name}
          autoComplete="off"
          aria-invalid={errors.name === undefined ? undefined : true}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <TonePicker name={name} value={tone} onChange={setTone} />
      {admin && !self && profile?.kind !== "guest" ? (
        <div className="field">
          <span className="field-label">{m.users_role()}</span>
          <Segmented
            label={m.users_role()}
            value={role}
            onChange={setRole}
            segments={[
              { value: "user", label: m.users_role_user() },
              { value: "admin", label: m.profile_admin() },
            ]}
          />
        </div>
      ) : null}
      <div className="grid gap-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[14.5px] font-semibold" id="pin-switch-label">
              {m.profile_pin_switch()}
            </div>
          </div>
          <Switch
            checked={pinOn}
            aria-labelledby="pin-switch-label"
            onCheckedChange={(checked) => {
              setPinMode(checked ? (hadPin ? "keep" : "set") : hadPin ? "remove" : "keep");
              setPinValue("");
              setErrors({});
            }}
          />
        </div>
        {hadPin && pinMode === "keep" ? (
          <Button
            size="sm"
            variant="secondary"
            className="justify-self-start"
            onClick={() => setPinMode("set")}
          >
            {m.profile_pin_change()}
          </Button>
        ) : null}
        {self && hadPin && pinMode !== "keep" ? (
          <Field label={m.profile_pin_current()} htmlFor="profile-pin-current">
            <Input
              id="profile-pin-current"
              value={currentPin}
              inputMode="numeric"
              autoComplete="off"
              maxLength={pinLength}
              onChange={(event) => setCurrentPin(pinInput(event.target.value))}
            />
          </Field>
        ) : null}
        {pinMode === "set" ? (
          <Field
            label={m.profile_pin_new()}
            hint={m.profile_pin_format()}
            htmlFor="profile-pin"
            {...(errors.pin === undefined ? {} : { error: errors.pin })}
          >
            <Input
              id="profile-pin"
              value={pin}
              inputMode="numeric"
              autoComplete="off"
              maxLength={pinLength}
              aria-invalid={errors.pin === undefined ? undefined : true}
              onChange={(event) => setPinValue(pinInput(event.target.value))}
            />
          </Field>
        ) : errors.pin === undefined ? null : (
          <span className="field-error" role="alert">
            {errors.pin}
          </span>
        )}
      </div>
      {editsAccess ? (
        <>
          <AccessField
            label={m.access_label()}
            tokens={tokens}
            onChange={setTokens}
            channels={channels}
            collections={collections}
          />
          <AccessOptions
            mayRecord={mayRecord}
            onMayRecordChange={setMayRecord}
            streams={streams}
            onStreamsChange={setStreams}
          />
        </>
      ) : null}
      {errors.form === undefined ? null : (
        <p className="field-error" role="alert">
          {errors.form}
        </p>
      )}
      {admin && profile !== undefined && !self ? (
        <RemoveConfirm
          name={profile.displayName}
          label={profile.kind === "guest" ? m.guest_remove() : m.users_remove()}
          confirmLabel={m.action_delete()}
          busy={remove.isPending}
          disabled={busy}
          onRemove={() =>
            remove.mutate(profile.id, {
              onSuccess: () => {
                toast({ title: m.toast_deleted_named({ name: profile.displayName }) });
                onDone();
              },
              onError: failed,
            })
          }
        />
      ) : null}
    </form>
  );
}

/**
 * `?dlg=profile:<id>` and `?dlg=profile:new`: add or edit a household profile (SPEC §8.7).
 * An `sm` dialog, a bottom sheet under 600 px, with Cancel and Save pinned at the bottom.
 */
export function ProfileDialog({
  profiles,
  me,
  channels,
  collections,
}: {
  profiles: readonly Profile[];
  me: User;
  channels: readonly Channel[];
  collections: readonly Collection[];
}) {
  const binding = useOverlayBinding("dlg", "profile");
  const overlay = useOverlay();
  const nameRef = useRef<HTMLInputElement | null>(null);
  const arg = binding.overlay?.arg ?? "new";
  const profile = profiles.find((candidate) => candidate.id === arg);
  const saving = useIsMutating({ mutationKey: profileWriteKey }) > 0;
  const label =
    profile === undefined ? m.profiles_add() : m.action_edit_named({ name: profile.displayName });
  return (
    <Dialog
      open={binding.open}
      onOpenChange={binding.onOpenChange}
      label={label}
      showTitle
      size="sm"
      keyboardFocus={nameRef}
      footer={
        <>
          <Button variant="ghost" onClick={() => void overlay.close()}>
            {m.action_cancel()}
          </Button>
          <Button variant="primary" type="submit" form="profile-form" busy={saving}>
            {profile === undefined ? m.profiles_add() : m.action_save()}
          </Button>
        </>
      }
    >
      <ProfileForm
        // A deep link can open before the profiles arrive; the form starts over once they do.
        key={`${arg}:${profile === undefined ? "none" : "ready"}`}
        profile={profile}
        me={me}
        channels={channels}
        collections={collections}
        onDone={() => void overlay.close()}
        nameRef={nameRef}
      />
    </Dialog>
  );
}
