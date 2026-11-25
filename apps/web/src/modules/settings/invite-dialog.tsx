import type { Guest } from "@slipstream/api";
import {
  accessFromTokens,
  type AccessToken,
  accessTokens,
  type Channel,
  type Collection,
  type InviteExpiry,
} from "@slipstream/domain";
import { useIsMutating } from "@tanstack/react-query";
import { type RefObject, useRef, useState } from "react";
import { inviteExpiryLabel, m } from "@slipstream/i18n";
import { Field } from "~/ui/controls.tsx";
import { Dialog } from "~/ui/dialog.tsx";
import { Icon } from "~/ui/icon.tsx";
import { LinkIcon } from "~/ui/icons.ts";
import { useOverlay, useOverlayBinding } from "~/ui/overlay/use-overlay.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { Input } from "~/ui/primitives/input.tsx";
import { toast } from "~/ui/toast-manager.ts";
import { AccessField } from "./access-field.tsx";
import { guestWriteKey } from "./write-keys.ts";
import { AccessOptions, RemoveConfirm } from "./access-options.tsx";
import { Select } from "~/ui/primitives/select.tsx";
import { copyText } from "~/ui/clipboard.ts";
import { useInviteGuest, useRemoveProfile, useUpdateGuest } from "./queries.ts";

const expiries: readonly InviteExpiry[] = ["oneDay", "sevenDays", "untilUsed"];

/** The form inside the dialog: a new invite, or a guest's access. */
function InviteForm({
  guest,
  channels,
  collections,
  nameRef,
  onDone,
}: {
  guest: Guest | undefined;
  channels: readonly Channel[];
  collections: readonly Collection[];
  nameRef: RefObject<HTMLInputElement | null>;
  onDone: () => void;
}) {
  const invite = useInviteGuest();
  const update = useUpdateGuest();
  const remove = useRemoveProfile();
  const [name, setName] = useState("");
  const [tokens, setTokens] = useState<AccessToken[]>(
    guest === undefined ? [] : accessTokens(guest.access),
  );
  const [mayRecord, setMayRecord] = useState(guest?.access.mayRecord ?? false);
  const [streams, setStreams] = useState(guest?.access.maxStreams ?? 1);
  const [expiry, setExpiry] = useState<InviteExpiry>("sevenDays");
  // A problem with the name shows under it; anything else under the form.
  const [error, setError] = useState<{ field: "name" | "form"; text: string }>();
  const busy = invite.isPending || update.isPending;

  const submit = async () => {
    // One invite at a time: Enter or a second click while it runs sends nothing more.
    if (busy) return;
    const access = accessFromTokens(tokens, {
      mayRecord,
      maxStreams: streams === 0 ? undefined : streams,
    });
    try {
      if (guest === undefined) {
        if (name.trim() === "") {
          setError({ field: "name", text: m.invite_name_missing() });
          return;
        }
        const created = await invite.mutateAsync({ name: name.trim(), access, expiry });
        const copied = await copyText(created.url);
        toast({
          title: copied ? m.invite_copied() : m.invite_created(),
          description: m.invite_send_hint({ expiry: inviteExpiryLabel(expiry) }),
        });
      } else {
        await update.mutateAsync({ id: guest.id, update: { access } });
        toast({ title: m.guest_saved({ name: guest.displayName }) });
      }
      onDone();
    } catch {
      setError({ field: "form", text: m.state_not_saved() });
    }
  };

  return (
    <form
      id="invite-form"
      className="grid gap-4 p-5.5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {guest === undefined ? (
        <Field
          label={m.field_name()}
          reserve
          htmlFor="invite-name"
          {...(error?.field === "name" ? { error: error.text } : {})}
        >
          <Input
            id="invite-name"
            ref={nameRef}
            value={name}
            placeholder={m.invite_name_placeholder()}
            autoComplete="off"
            onChange={(event) => {
              setName(event.target.value);
              setError(undefined);
            }}
          />
        </Field>
      ) : null}
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
      {guest === undefined ? (
        <Field label={m.invite_expires()} htmlFor="invite-expiry">
          <Select
            id="invite-expiry"
            value={expiry}
            options={expiries.map((value) => ({ value, label: inviteExpiryLabel(value) }))}
            onChange={setExpiry}
          />
        </Field>
      ) : null}
      {error?.field === "form" ? (
        <p className="field-error" role="alert">
          {error.text}
        </p>
      ) : null}
      {guest === undefined ? null : (
        <RemoveConfirm
          name={guest.displayName}
          label={m.guest_remove()}
          confirmLabel={m.guest_remove()}
          busy={remove.isPending}
          onRemove={() =>
            remove.mutate(guest.id, {
              onSuccess: () => {
                toast({ title: m.toast_deleted_named({ name: guest.displayName }) });
                onDone();
              },
              onError: () => setError({ field: "form", text: m.state_not_saved() }),
            })
          }
        />
      )}
    </form>
  );
}

/**
 * `?dlg=invite` (a new invite) and `?dlg=invite:<guestId>` (a guest's access), SPEC §7.8, §8.7:
 * an `sm` dialog, a bottom sheet under 600 px, with the actions pinned at the bottom. Opened from
 * the keyboard it lands on Name, never on Close.
 */
export function InviteDialog({
  guests,
  channels,
  collections,
}: {
  guests: readonly Guest[];
  channels: readonly Channel[];
  collections: readonly Collection[];
}) {
  const binding = useOverlayBinding("dlg", "invite");
  const overlay = useOverlay();
  const nameRef = useRef<HTMLInputElement | null>(null);
  const arg = binding.overlay?.arg;
  const guest = guests.find((candidate) => candidate.id === arg);
  const saving = useIsMutating({ mutationKey: guestWriteKey }) > 0;
  const label =
    guest === undefined ? m.invite_title() : m.guest_access_title({ name: guest.displayName });
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
          <Button
            variant="primary"
            type="submit"
            form="invite-form"
            busy={saving}
            {...(guest === undefined ? { icon: <Icon icon={LinkIcon} /> } : {})}
          >
            {guest === undefined ? m.invite_copy_link() : m.action_save()}
          </Button>
        </>
      }
    >
      <InviteForm
        key={`${arg ?? "new"}:${guest === undefined ? "none" : "ready"}`}
        guest={guest}
        channels={channels}
        collections={collections}
        nameRef={nameRef}
        onDone={() => void overlay.close()}
      />
    </Dialog>
  );
}
