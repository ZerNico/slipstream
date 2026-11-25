import {
  accessNames,
  type AccessToken,
  addToken,
  type Channel,
  type Collection,
  removeToken,
  tokenKey,
  tokenName,
} from "@slipstream/domain";
import { useId } from "react";
import { m } from "@slipstream/i18n";
import { Icon } from "~/ui/icon.tsx";
import { CloseIcon } from "~/ui/icons.ts";
import { Select } from "~/ui/primitives/select.tsx";

/**
 * "What they see" (SPEC §8.7): channels and collections as tokens with a remove button each,
 * and an "Add…" picker that lists what isn't there yet (collections, then channels). The
 * native picker keeps it usable on phones and with a keyboard.
 */
export function AccessField({
  label,
  tokens,
  onChange,
  channels,
  collections,
}: {
  label: string;
  tokens: readonly AccessToken[];
  onChange: (tokens: AccessToken[]) => void;
  channels: readonly Channel[];
  collections: readonly Collection[];
}) {
  const id = useId();
  const names = accessNames(channels, collections);
  const taken = new Set(tokens.map(tokenKey));
  const freeCollections = collections.filter((c) => !taken.has(`collection:${c.id}`));
  const freeChannels = channels.filter((c) => !c.hidden && !taken.has(`channel:${c.id}`));
  return (
    <div className="field">
      <span className="field-label" id={`${id}-label`}>
        {label}
      </span>
      <div
        className="flex min-h-ctl-md flex-wrap items-center gap-1.5 rounded-md bg-bg-2 py-1 pr-1.5 pl-2 shadow-[inset_0_0_0_1px_var(--line-2)] focus-within:shadow-[inset_0_0_0_2px_var(--brand)] coarse:min-h-tap"
        role="group"
        aria-labelledby={`${id}-label`}
      >
        {tokens.map((token) => {
          const name = tokenName(token, names);
          return (
            <span
              key={tokenKey(token)}
              className="inline-flex h-7.5 max-w-full min-w-0 items-center gap-1 rounded-sm bg-hover pr-1 pl-2.5 text-[13.5px] font-[550] shadow-[inset_0_0_0_1px_var(--line-2)]"
            >
              {/* A long channel name is cut, never wider than the field; the full name is the title. */}
              <span className="min-w-0 truncate" title={name}>
                {name}
              </span>
              <button
                type="button"
                className="hit relative grid size-5.5 flex-none place-items-center rounded-[6px] text-fg-3 fine:hover:bg-press fine:hover:text-fg"
                aria-label={m.access_remove({ name })}
                onClick={() => onChange(removeToken(tokens, token))}
              >
                <Icon icon={CloseIcon} size={14} />
              </button>
            </span>
          );
        })}
        <Select
          quiet
          className="min-w-[96px] flex-1"
          aria-label={m.access_add_label()}
          placeholder={m.field_value_more()}
          value={null}
          onChange={(picked) => {
            const [kind, value] = picked.split(/:(.*)/su);
            const channel = channels.find((c) => c.id === value);
            const collection = collections.find((c) => c.id === value);
            const token: AccessToken | undefined =
              kind === "channel" && channel
                ? { kind: "channel", id: channel.id }
                : kind === "collection" && collection
                  ? { kind: "collection", id: collection.id }
                  : undefined;
            if (token) onChange(addToken(tokens, token));
          }}
          groups={[
            ...(freeCollections.length > 0
              ? [
                  {
                    label: m.library_collections(),
                    options: freeCollections.map((collection) => ({
                      value: `collection:${collection.id}`,
                      label: collection.name,
                    })),
                  },
                ]
              : []),
            ...(freeChannels.length > 0
              ? [
                  {
                    label: m.channels_heading(),
                    options: freeChannels.map((channel) => ({
                      value: `channel:${channel.id}`,
                      label: channel.name,
                    })),
                  },
                ]
              : []),
          ]}
        />
      </div>
      {tokens.length === 0 ? <span className="field-hint">{m.access_everything()}</span> : null}
    </div>
  );
}
