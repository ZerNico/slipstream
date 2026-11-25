import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import {
  expectedLock,
  pinInput,
  pinLength,
  type Profile,
  type SwitchLock,
} from "@slipstream/domain";
import { useEffect, useRef, useState } from "react";
import { m } from "@slipstream/i18n";
import type { OverlayComponentProps } from "~/shell/overlay-host.tsx";
import { announce } from "~/ui/announce-store.ts";
import { Dialog } from "~/ui/dialog.tsx";
import { Icon } from "~/ui/icon.tsx";
import { LockIcon } from "~/ui/icons.ts";
import { useOverlay } from "~/ui/overlay/use-overlay.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { Input } from "~/ui/primitives/input.tsx";
import { toast } from "~/ui/toast-manager.ts";
import { cn } from "~/ui/utils.ts";
import { problemOf } from "~/api/errors.ts";
import { Avatar } from "~/ui/avatar.tsx";
import { useQueries } from "~/api/hooks.ts";
import { useSwitchProfile } from "./queries.ts";
import { focusAfterRender } from "~/ui/focus-after-render.ts";

/** The PIN pad's cells, one per digit (`pinLength`). */
const pinCells = Array.from({ length: pinLength }, (_, index) => index);

/** One box per digit over one numeric input, so the PIN reads like a PIN on every keyboard. */
function PinBoxes({ value }: { value: string }) {
  return (
    <div className="flex justify-center gap-2.5" aria-hidden="true">
      {pinCells.map((index) => (
        <span
          key={index}
          className={cn(
            "grid h-14 w-12 place-items-center rounded-md bg-surface font-display text-[24px] font-bold shadow-[inset_0_0_0_1px_var(--line-2)]",
            index === value.length && "shadow-[inset_0_0_0_2px_var(--brand)]",
          )}
        >
          {index < value.length ? "•" : ""}
        </span>
      ))}
    </div>
  );
}

/**
 * The switch itself (SPEC §7.8): a profile without a lock switches at once; a PIN profile asks
 * for its four digits (sent as soon as the fourth is typed); an admin without a PIN asks for the
 * password. Wrong answers say so in place; too many lock it for a while.
 */
function SwitchForm({ profile, onSwitched }: { profile: Profile; onSwitched: () => void }) {
  const switching = useSwitchProfile();
  const [lock, setLock] = useState<SwitchLock>(expectedLock(profile));
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | undefined>();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const started = useRef(false);

  const attempt = (value: string | undefined) => {
    setError(undefined);
    switching.mutate(
      { id: profile.id, ...(value === undefined ? {} : { secret: value }) },
      {
        onSuccess: onSwitched,
        onError: (failure) => {
          const problem = problemOf(failure);
          setSecret("");
          if (problem._tag === "ProfileLocked") setLock(problem.requires);
          else if (problem._tag === "InvalidCredentials") {
            setError(lock === "password" ? m.signin_wrong() : m.profile_pin_wrong());
          } else if (problem._tag === "RateLimited") {
            setError(m.signin_rate_limited({ seconds: problem.retryAfterSeconds }));
          } else if (problem._tag === "Forbidden") setError(m.switch_forbidden());
          else setError(m.error_unexpected());
          focusAfterRender(inputRef);
        },
      },
    );
  };

  // A profile without a lock switches as soon as the dialog opens: one tap from the menu.
  useEffect(() => {
    if (lock !== "none" || started.current) return;
    started.current = true;
    attempt(undefined);
  });

  if (lock === "none") {
    return (
      <div className="grid justify-items-center gap-3 p-5.5 text-center" role="status">
        <Avatar name={profile.displayName} tone={profile.avatarTone} size={64} />
        <p className="type-h3 [overflow-wrap:anywhere]">
          {error ?? m.switch_working({ name: profile.displayName })}
        </p>
        {error === undefined ? null : (
          <Button onClick={() => attempt(undefined)}>{m.action_try_again()}</Button>
        )}
      </div>
    );
  }

  return (
    <form
      id="switch-form"
      className="grid justify-items-center gap-4 p-5.5 text-center"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (secret !== "") attempt(secret);
      }}
    >
      <span className="relative">
        <Avatar name={profile.displayName} tone={profile.avatarTone} size={64} />
        <span className="absolute -right-1 -bottom-1 grid size-7 place-items-center rounded-full bg-raised text-fg-2 shadow-[0_0_0_2px_var(--surface)]">
          <Icon icon={LockIcon} size={14} />
        </span>
      </span>
      <div className="grid min-w-0 gap-1">
        <h2 className="type-h2 [overflow-wrap:anywhere]">
          {m.switch_title({ name: profile.displayName })}
        </h2>
        <p className="text-[14px] text-fg-2">
          {lock === "pin" ? m.profile_locked_pin() : m.profile_locked_password()}
        </p>
      </div>
      {lock === "pin" ? (
        <label className="relative grid w-full max-w-[260px] justify-items-center">
          <span className="sr-only">{m.profiles_pin()}</span>
          <PinBoxes value={secret} />
          <input
            ref={inputRef}
            className="absolute inset-0 opacity-0"
            value={secret}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={pinLength}
            autoFocus
            aria-invalid={error === undefined ? undefined : true}
            aria-describedby={error === undefined ? undefined : "switch-error"}
            readOnly={switching.isPending}
            onChange={(event) => {
              const next = pinInput(event.target.value);
              setSecret(next);
              setError(undefined);
              if (next.length === pinLength) attempt(next);
            }}
          />
        </label>
      ) : (
        <div className="grid w-full gap-1.5 text-left">
          <label className="field-label" htmlFor="switch-password">
            {m.signin_password()}
          </label>
          <Input
            id="switch-password"
            ref={inputRef}
            type="password"
            autoComplete="current-password"
            autoFocus
            value={secret}
            aria-invalid={error === undefined ? undefined : true}
            aria-describedby={error === undefined ? undefined : "switch-error"}
            onChange={(event) => {
              setSecret(event.target.value);
              setError(undefined);
            }}
          />
        </div>
      )}
      <p
        id="switch-error"
        role="alert"
        className={cn("min-h-[1.4em] text-[13px] text-live-fg", error === undefined && "invisible")}
      >
        {error ?? ""}
      </p>
      {lock === "password" ? (
        <Button
          variant="primary"
          size="lg"
          type="submit"
          className="w-full"
          busy={switching.isPending}
          disabled={secret === ""}
        >
          {m.switch_confirm()}
        </Button>
      ) : null}
    </form>
  );
}

/**
 * `?dlg=pin:<profileId>` (SPEC §2.4, §7.8): switching this browser to a household profile from
 * the avatar menu. After the switch every query starts over for the new profile and the app
 * goes Home, which re-selects the hero, rows, pill and library for them.
 */
export default function PinDialog({ open, overlay, onOpenChange }: OverlayComponentProps) {
  const queries = useQueries();
  const controls = useOverlay();
  const router = useRouter();
  const profiles = useQuery(queries.profiles());
  const profile = profiles.data?.find((candidate) => candidate.id === overlay.arg);
  const label =
    profile === undefined
      ? m.account_switch_profile()
      : m.switch_title({ name: profile.displayName });

  return (
    <Dialog open={open} onOpenChange={onOpenChange} label={label} size="sm">
      {profile === undefined ? (
        <div className="grid justify-items-center gap-3 p-5.5 text-center">
          <p className="text-[14px] text-fg-2">
            {profiles.isPending ? m.state_loading() : m.switch_unknown()}
          </p>
        </div>
      ) : (
        <SwitchForm
          key={profile.id}
          profile={profile}
          onSwitched={() => {
            announce(m.switch_done({ name: profile.displayName }));
            toast({ title: m.switch_done({ name: profile.displayName }), alreadyAnnounced: true });
            controls.leaveTo({ to: "/" });
            void router.invalidate();
          }}
        />
      )}
    </Dialog>
  );
}
