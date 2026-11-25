import { useState } from "react";
import { type Channel, channelMark, isHttpUrl } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { ChannelLogo } from "~/ui/artwork/artwork.tsx";
import { Field } from "~/ui/controls.tsx";
import { Dialog } from "~/ui/dialog.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { Input } from "~/ui/primitives/input.tsx";

/** The logo's address: set one, or remove it so the channel shows its short mark. */
export function LogoDialog({
  channel,
  open,
  onOpenChange,
  onSave,
}: {
  channel: Channel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (logoUrl: string | undefined) => void;
}) {
  const [url, setUrl] = useState(channel.logoUrl ?? "");
  const valid = url.trim() === "" || isHttpUrl(url);
  const done = (logoUrl: string | undefined) => {
    onSave(logoUrl);
    onOpenChange(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      label={m.channel_logo_title({ name: channel.name })}
      showTitle
      size="sm"
      footer={
        <>
          {channel.logoUrl === undefined ? null : (
            <Button variant="ghost" className="mr-auto" onClick={() => done(undefined)}>
              {m.channel_logo_remove()}
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {m.action_cancel()}
          </Button>
          <Button variant="primary" type="submit" form={`logo-${channel.id}`} disabled={!valid}>
            {m.action_save()}
          </Button>
        </>
      }
    >
      <form
        id={`logo-${channel.id}`}
        className="grid gap-4 p-5.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          done(url.trim() === "" ? undefined : url.trim());
        }}
      >
        <div className="flex items-center gap-3">
          <ChannelLogo
            mark={channelMark(channel.name)}
            size="md"
            {...(valid && url.trim() !== "" ? { logoUrl: url.trim() } : {})}
          />
          <div className="min-w-0 flex-1">
            <Field
              label={m.channel_logo_url()}
              reserve
              htmlFor={`logo-url-${channel.id}`}
              {...(valid ? {} : { error: m.source_url_invalid() })}
            >
              <Input
                id={`logo-url-${channel.id}`}
                value={url}
                inputMode="url"
                onChange={(event) => setUrl(event.target.value)}
              />
            </Field>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
