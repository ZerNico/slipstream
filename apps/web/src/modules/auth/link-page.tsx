import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  type AvatarTone,
  profileChoices,
  type Role,
  type User,
  type UserId,
} from "@slipstream/domain";
import { useState } from "react";
import { useQueries } from "~/api/hooks.ts";
import { useApproveDevice } from "~/api/mutations.ts";
import { m } from "@slipstream/i18n";
import { problemTitle } from "~/api/problem-title.ts";
import { deviceKindLabel } from "./auth-text.ts";
import { ResultNote } from "~/ui/result-note.tsx";
import { Avatar } from "~/ui/avatar.tsx";
import { Field } from "~/ui/controls.tsx";
import { Icon } from "~/ui/icon.tsx";
import { CheckIcon, CloseIcon, TvIcon, WarningIcon } from "~/ui/icons.ts";
import { Button } from "~/ui/primitives/button.tsx";
import { Input } from "~/ui/primitives/input.tsx";
import { LoadingScope, Sk } from "~/ui/skeleton.tsx";
import { cn } from "~/ui/utils.ts";
import { AuthHeading, AuthLayout } from "./auth-layout.tsx";
import {
  approveAs,
  approveHousehold,
  approveProblem,
  blockSignIn,
  normaliseUserCode,
} from "@slipstream/api";

/** Someone a TV can sign in as. */
interface Signable {
  readonly id: UserId;
  readonly displayName: string;
  readonly role: Role;
  readonly avatarTone: AvatarTone;
}

/** Whom the TV signs in as: the shared household, or one named profile. */
type Choice = { readonly kind: "household" } | { readonly kind: "profile"; readonly id: UserId };

/** "Enter the code your TV shows", for when the QR code was not scanned. */
function EnterCode() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  return (
    <AuthLayout>
      <AuthHeading title={m.device_link_tv()} text={m.approve_enter_hint()} />
      <form
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          const clean = normaliseUserCode(code);
          if (clean !== "") void navigate({ to: "/link", search: { code: clean } });
        }}
      >
        <Field label={m.approve_code()} htmlFor="link-code">
          <Input
            id="link-code"
            value={code}
            autoCapitalize="characters"
            autoComplete="one-time-code"
            spellCheck={false}
            autoFocus
            onChange={(event) => setCode(event.target.value)}
          />
        </Field>
        <Button variant="primary" size="lg" type="submit" disabled={normaliseUserCode(code) === ""}>
          {m.action_continue()}
        </Button>
      </form>
    </AuthLayout>
  );
}

/** The code as boxes, split in the middle, to compare with the TV at a glance. */
function CodeBoxes({ code }: { code: string }) {
  const half = Math.ceil(code.length / 2);
  const slots = code.split("").map((char, position) => ({
    char,
    id: `slot-${position}`,
    gap: position === half && code.length > 4,
  }));
  // Boxes are 44 px wide and give way together on a narrow phone, so the code never overflows.
  return (
    <div
      className="flex min-w-0 justify-center gap-1.5"
      aria-label={code.split("").join(" ")}
      role="img"
    >
      {slots.map((slot) => (
        <span key={slot.id} className="contents">
          {slot.gap ? (
            <span className="grid w-3 flex-none place-items-center text-fg-3" aria-hidden="true">
              –
            </span>
          ) : null}
          <span
            aria-hidden="true"
            className="grid h-14 min-w-0 flex-[0_1_44px] place-items-center rounded-md bg-surface font-display text-[24px] font-bold shadow-[inset_0_0_0_1px_var(--line-2)]"
          >
            {slot.char}
          </span>
        </span>
      ))}
    </div>
  );
}

/** One "sign this TV in as" option: radio, who, what it means, avatars. */
function RoleOption({
  checked,
  onSelect,
  title,
  text,
  people,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  text: string;
  people: readonly Signable[];
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={cn(
        "grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md px-4 py-3.5 text-left fine:hover:bg-hover",
        checked
          ? "shadow-[inset_0_0_0_2px_var(--brand)]"
          : "shadow-[inset_0_0_0_1px_var(--line-2)]",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-5 rounded-full",
          checked
            ? "shadow-[inset_0_0_0_6px_var(--brand)]"
            : "shadow-[inset_0_0_0_1.5px_var(--fg-4)]",
        )}
      />
      <span className="min-w-0">
        <span className="block text-[14.5px] font-semibold [overflow-wrap:anywhere]">{title}</span>
        <span className="block text-meta text-fg-2">{text}</span>
      </span>
      <span className="flex" aria-hidden="true">
        {people.slice(0, 4).map((person, index) => (
          <span
            key={person.id}
            className={cn("rounded-full shadow-[0_0_0_2px_var(--bg)]", index > 0 && "-ml-2")}
          >
            <Avatar name={person.displayName} tone={person.avatarTone} size={26} />
          </span>
        ))}
      </span>
    </button>
  );
}

/** The end of the flow: signed in, or blocked. */
function Outcome({ approved, device }: { approved: boolean; device: string }) {
  return (
    <AuthLayout>
      <div className="grid justify-items-center gap-4 text-center">
        <span
          className={cn(
            "grid size-18 place-items-center rounded-full",
            approved ? "bg-ok-soft text-ok-fg" : "bg-hover text-fg-2",
          )}
        >
          <Icon icon={approved ? CheckIcon : CloseIcon} size={24} />
        </span>
        <h1 className="type-h1 [overflow-wrap:anywhere]">
          {approved ? m.approve_done_title({ device }) : m.approve_rejected_title()}
        </h1>
        {approved ? null : <p className="text-fg-2">{m.approve_rejected_body()}</p>}
      </div>
      {approved ? (
        <Button
          variant="primary"
          size="lg"
          nativeButton={false}
          render={<Link to="/settings/$section" params={{ section: "users" }} />}
        >
          {m.action_done()}
        </Button>
      ) : (
        <Button size="lg" nativeButton={false} render={<Link to="/" />}>
          {m.approve_back_home()}
        </Button>
      )}
    </AuthLayout>
  );
}

/**
 * "Sign in on Living Room TV?" (SPEC §8.8): the device, the code to compare, the warning, and
 * whom the TV signs in as: the household (profiles picked on the TV, never admin rights) or one
 * named profile. "This isn't my TV" blocks it.
 */
function Approve({ code, me }: { code: string; me: User }) {
  const queries = useQueries();
  const navigate = useNavigate();
  const pending = useQuery(queries.pendingSignIn(code));
  const profiles = useQuery(queries.profiles());
  const approve = useApproveDevice();
  const admin = me.role === "admin";
  // The approver as a profile (with its picture), or plain until the profiles arrive.
  const self: Signable = profiles.data?.find((person) => person.id === me.id) ?? {
    ...me,
    avatarTone: "amber",
  };
  // By name: every profile for an admin, otherwise only the approver (as the phone app offers).
  const named = profileChoices(self, profiles.data);
  // A household TV switches between the non-admin profiles and never acts with admin rights.
  const household = (profiles.data ?? []).filter((person) => person.role !== "admin");
  const [choice, setChoice] = useState<Choice>(
    admin ? { kind: "household" } : { kind: "profile", id: me.id },
  );
  const offersHousehold = admin && household.length > 0;
  const current: Choice =
    choice.kind === "household" && !offersHousehold ? { kind: "profile", id: me.id } : choice;
  const loading = pending.isPending || (profiles.isPending && !profiles.isError);

  if (pending.isError && approveProblem(pending.error) === "invalidCode") {
    return (
      <AuthLayout>
        <AuthHeading title={m.device_link_tv()} />
        <ResultNote tone="error">{m.approve_code_invalid()}</ResultNote>
        <Button size="lg" onClick={() => void navigate({ to: "/link", search: {} })}>
          {m.approve_other_code()}
        </Button>
      </AuthLayout>
    );
  }
  const device = pending.data?.device.name ?? m.approve_this_tv();
  if (approve.isSuccess) return <Outcome approved={approve.variables.approve} device={device} />;

  return (
    <AuthLayout>
      <LoadingScope loading={loading} className="grid gap-5">
        <AuthHeading
          title={m.approve_title({ device })}
          text={m.approve_signed_in_as({ name: me.displayName })}
        />
        <div className="panel flex items-center gap-3.5 p-4">
          <span className="grid size-13 flex-none place-items-center rounded-[14px] bg-brand-soft text-brand-fg">
            <Icon icon={TvIcon} size={24} />
          </span>
          <div className="min-w-0">
            <b className="block text-[16px] [overflow-wrap:anywhere]">
              <Sk>{pending.data?.device.name}</Sk>
            </b>
            <span className="text-meta text-fg-2">
              <Sk>
                {pending.data === undefined ? undefined : deviceKindLabel(pending.data.device.kind)}
              </Sk>
            </span>
          </div>
        </div>
        <div className="grid gap-2">
          <span className="field-label">{m.approve_code()}</span>
          <CodeBoxes code={code} />
          <p className="flex items-center justify-center gap-1.5 text-[13px] text-warn-fg">
            <Icon icon={WarningIcon} size={16} />
            {m.approve_warning()}
          </p>
        </div>
        <div className="grid gap-2" role="radiogroup" aria-labelledby="link-as">
          <span className="field-label" id="link-as">
            {m.approve_as()}
          </span>
          {offersHousehold ? (
            <RoleOption
              checked={current.kind === "household"}
              onSelect={() => setChoice({ kind: "household" })}
              title={m.profiles_everyone()}
              text={m.approve_household_text({
                names: household.map((person) => person.displayName).join(", "),
              })}
              people={household}
            />
          ) : null}
          {named.map((person) => (
            <RoleOption
              key={person.id}
              checked={current.kind === "profile" && current.id === person.id}
              onSelect={() => setChoice({ kind: "profile", id: person.id })}
              title={
                person.role === "admin"
                  ? m.approve_admin_name({ name: person.displayName })
                  : person.displayName
              }
              text={person.role === "admin" ? m.approve_admin_hint() : m.approve_household_hint()}
              people={[person]}
            />
          ))}
        </div>
        {approve.isError ? (
          <ResultNote tone="error">
            {approveProblem(approve.error) === "invalidCode"
              ? m.approve_code_invalid()
              : problemTitle(approve.error)}
          </ResultNote>
        ) : null}
        <Button
          variant="primary"
          size="lg"
          icon={<Icon icon={CheckIcon} />}
          busy={approve.isPending && approve.variables.approve}
          onClick={() =>
            approve.mutate(
              current.kind === "household"
                ? approveHousehold(code, household, me)
                : approveAs(code, current.id, me),
            )
          }
        >
          {m.approve_confirm()}
        </Button>
        <Button
          variant="ghost"
          busy={approve.isPending && !approve.variables.approve}
          onClick={() => approve.mutate(blockSignIn(code))}
        >
          {m.approve_reject()}
        </Button>
      </LoadingScope>
    </AuthLayout>
  );
}

/** The page a TV's QR code opens (`/link?code=QK74RM`), or the code entry without one. */
export function LinkPage({ code, me }: { code: string | undefined; me: User }) {
  return code === undefined ? <EnterCode /> : <Approve key={code} code={code} me={me} />;
}
