import { ContextMenu } from "@base-ui/react/context-menu";
import { useNavigate } from "@tanstack/react-router";
import { type ReactElement, useState } from "react";
import { type Channel, type ChannelChange, channelChangePayload } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { useUpdateChannel } from "~/api/mutations.ts";
import { Dialog } from "~/ui/dialog.tsx";
import { Field } from "~/ui/controls.tsx";
import { Icon } from "~/ui/icon.tsx";
import { EditIcon, HideIcon, ImageIcon, PlayIcon } from "~/ui/icons.ts";
import { Button } from "~/ui/primitives/button.tsx";
import { Input } from "~/ui/primitives/input.tsx";
import { toast } from "~/ui/toast-manager.ts";
import { LogoDialog } from "../settings/logo-dialog.tsx";
import { useViewer } from "~/api/viewer.ts";

/** Renames a channel: its name in a field, saved with Enter. */
function RenameDialog({
  channel,
  open,
  onOpenChange,
  onSave,
}: {
  channel: Channel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(channel.name);
  const valid = name.trim() !== "";
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      label={m.guide_channel_rename_title({ name: channel.name })}
      showTitle
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {m.action_cancel()}
          </Button>
          <Button variant="primary" type="submit" form={`rename-${channel.id}`} disabled={!valid}>
            {m.action_save()}
          </Button>
        </>
      }
    >
      <form
        id={`rename-${channel.id}`}
        className="p-5.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          if (name.trim() !== channel.name) onSave(name.trim());
          onOpenChange(false);
        }}
      >
        <Field label={m.field_name()} htmlFor={`rename-input-${channel.id}`}>
          <Input
            id={`rename-input-${channel.id}`}
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  );
}

/**
 * The guide's channel menu (right click, or a long press on touch): watch it live and, for an
 * admin, rename it, change its logo or hide it (with Undo). The cell itself still plays on click.
 */
export function ChannelMenu({ channel, children }: { channel: Channel; children: ReactElement }) {
  const { isAdmin: admin } = useViewer();
  const navigate = useNavigate();
  const update = useUpdateChannel();
  const [dialog, setDialog] = useState<"rename" | "logo" | null>(null);
  const save = (change: ChannelChange, onSuccess?: () => void) =>
    update.mutate(
      { id: channel.id, update: channelChangePayload(change) },
      {
        ...(onSuccess ? { onSuccess } : {}),
        onError: () => toast({ title: m.guide_action_failed(), type: "error" }),
      },
    );
  const item = "menu-item";
  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger render={children} />
        <ContextMenu.Portal>
          <ContextMenu.Positioner className="z-(--z-menu) outline-none" collisionPadding={8}>
            <ContextMenu.Popup className="menu" aria-label={channel.name}>
              <ContextMenu.Item
                className={item}
                onClick={() =>
                  void navigate({ to: "/watch/live/$channel", params: { channel: channel.id } })
                }
              >
                <span className="menu-item-icon">
                  <Icon icon={PlayIcon} size={16} />
                </span>
                {m.player_watch_live()}
              </ContextMenu.Item>
              {admin ? (
                <>
                  <ContextMenu.Separator className="menu-sep" />
                  <ContextMenu.Item className={item} onClick={() => setDialog("rename")}>
                    <span className="menu-item-icon">
                      <Icon icon={EditIcon} size={16} />
                    </span>
                    {m.guide_channel_rename()}
                  </ContextMenu.Item>
                  <ContextMenu.Item className={item} onClick={() => setDialog("logo")}>
                    <span className="menu-item-icon">
                      <Icon icon={ImageIcon} size={16} />
                    </span>
                    {m.guide_channel_logo()}
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    className={item}
                    onClick={() =>
                      save({ hidden: true }, () =>
                        toast({
                          title: m.guide_channel_hidden({ name: channel.name }),
                          undo: () => save({ hidden: false }),
                        }),
                      )
                    }
                  >
                    <span className="menu-item-icon">
                      <Icon icon={HideIcon} size={16} />
                    </span>
                    {m.guide_channel_hide()}
                  </ContextMenu.Item>
                </>
              ) : null}
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      {dialog === "rename" ? (
        <RenameDialog
          channel={channel}
          open
          onOpenChange={(open) => setDialog(open ? "rename" : null)}
          onSave={(name) => save({ name })}
        />
      ) : null}
      {dialog === "logo" ? (
        <LogoDialog
          channel={channel}
          open
          onOpenChange={(open) => setDialog(open ? "logo" : null)}
          onSave={(logoUrl) => save({ logoUrl })}
        />
      ) : null}
    </>
  );
}
