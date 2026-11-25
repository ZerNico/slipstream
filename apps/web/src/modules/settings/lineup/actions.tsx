import type { Channel } from "@slipstream/domain";
import { m } from "@slipstream/i18n";
import { Icon } from "~/ui/icon.tsx";
import {
  CheckIcon,
  DeleteIcon,
  FavouriteIcon,
  HideIcon,
  MoreIcon,
  NumberIcon,
  ShowIcon,
  ToTopIcon,
} from "~/ui/icons.ts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/ui/primitives/dropdown-menu.tsx";
import { Kbd } from "~/ui/primitives/kbd.tsx";
import { IconButton } from "~/ui/primitives/button.tsx";
import { useLineupActions } from "./actions-context.ts";

/** The favourite star: filled amber when on. */
export function FavouriteButton({ channel }: { channel: Channel }) {
  const actions = useLineupActions();
  return (
    <IconButton
      size="sm"
      label={m.lineup_favourite()}
      pressed={channel.favourite}
      onClick={(event) => {
        event.stopPropagation();
        actions.setFavourite([channel.id], !channel.favourite);
      }}
    >
      <Icon
        icon={FavouriteIcon}
        size={16}
        className={channel.favourite ? "text-brand-fg [&>*]:fill-current" : "text-fg-4"}
      />
    </IconButton>
  );
}

/** A channel's menu: the same moves as the bulk bar, for one channel. */
export function ChannelMenu({
  channel,
  selectable = true,
  className,
}: {
  channel: Channel;
  selectable?: boolean;
  className?: string;
}) {
  const actions = useLineupActions();
  const ids = [channel.id];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <IconButton
            size="sm"
            tooltip={false}
            label={m.lineup_menu_named({ name: channel.name })}
            className={className}
          >
            <Icon icon={MoreIcon} size={16} />
          </IconButton>
        }
      />
      <DropdownMenuContent aria-label={m.lineup_menu_named({ name: channel.name })}>
        <DropdownMenuItem icon={<Icon icon={ToTopIcon} />} onClick={() => actions.moveToTop(ids)}>
          {m.lineup_move_top()}
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<Icon icon={NumberIcon} />}
          end={<Kbd>#</Kbd>}
          onClick={() => actions.moveToNumber(ids)}
        >
          {m.lineup_move_to_number()}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={<Icon icon={channel.hidden ? ShowIcon : HideIcon} />}
          end={<Kbd>H</Kbd>}
          onClick={() => actions.setHidden(ids, !channel.hidden)}
        >
          {channel.hidden ? m.lineup_show() : m.lineup_hide()}
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<Icon icon={FavouriteIcon} />}
          onClick={() => actions.setFavourite(ids, !channel.favourite)}
        >
          {channel.favourite ? m.lineup_remove_favourite() : m.lineup_add_favourite()}
        </DropdownMenuItem>
        {selectable ? (
          <DropdownMenuItem
            icon={<Icon icon={CheckIcon} />}
            onClick={() => actions.select(channel.id, false)}
          >
            {m.lineup_select()}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<Icon icon={DeleteIcon} />} onClick={() => actions.remove(ids)}>
          {m.lineup_remove()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
