import { useUpdateRecording } from "~/api/mutations.ts";
import { m, pathLabels } from "@slipstream/i18n";
import { Icon } from "~/ui/icon.tsx";
import { AddIcon, FolderIcon } from "~/ui/icons.ts";
import { MenuItem, MenuLabel, MenuSeparator, ResponsiveMenu } from "~/ui/menu.tsx";
import { Button } from "~/ui/primitives/button.tsx";
import { toast } from "~/ui/toast-manager.ts";
import { groupKeyOf } from "./groups.ts";
import type { Entry } from "./library.ts";
import type { LibraryData } from "./queries.ts";

/**
 * "Move…" / "Add to collection…" (SPEC §7.5): pin the recording to a collection, unpin it, or
 * start a new collection from its group. A menu on desktop, a sheet on touch phones.
 */
export function CollectionMenu({ entry, data }: { entry: Entry; data: LibraryData }) {
  const update = useUpdateRecording();
  const inCollection = entry.group.collectionId !== undefined;
  const pin = (collectionId: Entry["pinnedCollectionId"] | null, name: string) =>
    update.mutate(
      { id: entry.id, update: { pinnedCollectionId: collectionId ?? null } },
      {
        onSuccess: () => toast({ title: m.move_done({ name }) }),
        onError: () => toast({ title: m.library_action_failed(), type: "error" }),
      },
    );
  return (
    <ResponsiveMenu
      name="move"
      label={m.library_move_title()}
      trigger={
        <Button size="sm" variant="ghost" busy={update.isPending}>
          {inCollection ? m.library_move() : m.library_add_to_collection()}
        </Button>
      }
    >
      <MenuLabel>{m.library_move_title()}</MenuLabel>
      {data.collections.map((collection) => (
        <MenuItem
          key={collection.id}
          icon={<Icon icon={FolderIcon} size={16} />}
          disabled={collection.id === entry.group.collectionId}
          onSelect={() => pin(collection.id, collection.name)}
        >
          {collection.name}
        </MenuItem>
      ))}
      {entry.pinnedCollectionId === undefined ? null : (
        <MenuItem onSelect={() => pin(null, m.move_no_collection())}>
          {m.move_no_collection()}
        </MenuItem>
      )}
      {/* A new collection starts from the automatic group the recording sits in today. */}
      {data.isAdmin && !inCollection ? (
        <>
          <MenuSeparator />
          <MenuItem
            icon={<Icon icon={AddIcon} size={16} />}
            link={{
              to: "/recordings/collections/new",
              search: { from: groupKeyOf(entry, pathLabels()) },
            }}
          >
            {m.library_new_from_this()}
          </MenuItem>
        </>
      ) : null}
    </ResponsiveMenu>
  );
}
