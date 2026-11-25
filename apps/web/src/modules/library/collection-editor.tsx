import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChannelId, type CollectionId, epochMs } from "@slipstream/domain";
import { problemOf } from "~/api/errors.ts";
import { useQueries } from "~/api/hooks.ts";
import { useUnlinkCollection } from "~/api/mutations.ts";
import { dayPill, m, pathLabels } from "@slipstream/i18n";
import { announce } from "~/ui/announce-store.ts";
import { Badge, Field } from "~/ui/controls.tsx";
import { Icon } from "~/ui/icon.tsx";
import { AddIcon, ChevronRightIcon, DeleteIcon, LinkIcon } from "~/ui/icons.ts";
import { Dialog } from "~/ui/dialog.tsx";
import { FormDisclosure } from "~/ui/disclosure.tsx";
import { FormSection } from "~/ui/form-section.tsx";
import { SaveActions, SaveBar } from "~/ui/save-bar.tsx";
import { Token, TokenField } from "~/ui/form-controls.tsx";
import { MenuItem, ResponsiveMenu } from "~/ui/menu.tsx";
import { Wrap } from "~/ui/page.tsx";
import { Button, IconButton } from "~/ui/primitives/button.tsx";
import { Input } from "~/ui/primitives/input.tsx";
import { Select } from "~/ui/primitives/select.tsx";
import { LoadingScope } from "~/ui/skeleton.tsx";
import { EmptyState } from "~/ui/states.tsx";
import { toast } from "~/ui/toast-manager.ts";
import { useNow } from "~/ui/use-now.ts";
import { cn } from "~/ui/utils.ts";
import { channelLabel } from "./art.ts";
import { type Crumb, Crumbs } from "~/ui/crumbs.tsx";
import {
  type CollectionDraft,
  draftFromCollection,
  draftFromGroup,
  draftToInput,
  draftToUpdate,
  emptyDraft,
  hasCriteria,
  type KeepChoice,
  layoutParts,
  type LayoutPart,
  markTitle,
  emptyPreview,
  opensAdvanced,
  previewDraft,
  type TreeNode,
} from "./editor.ts";
import { groupPage } from "./groups.ts";
import { useDeleteCollection, useSaveCollection } from "~/api/mutations.ts";
import { type LibraryData, useLibraryData } from "./queries.ts";
import { followsSummary, keepWords, partWords } from "./words.ts";

/** A token field with its visible label above it. */
function LabelledTokens({
  label,
  values,
  onChange,
}: {
  label: string;
  values: readonly string[];
  onChange: (values: readonly string[]) => void;
}) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold">
        {label}
      </label>
      <TokenField id={id} label={label} values={values} onChange={onChange} />
    </div>
  );
}

/** The channel token field: tokens and a "+ Add channel" picker. */
function ChannelField({
  data,
  values,
  onChange,
}: {
  data: LibraryData;
  values: readonly ChannelId[];
  onChange: (values: readonly ChannelId[]) => void;
}) {
  const queries = useQueries();
  const channels = useQuery(queries.channels());
  const id = useId();
  const available = (channels.data ?? []).filter((c) => !c.hidden && !values.includes(c.id));
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold">
        {m.channels_heading()}
      </label>
      <TokenField
        label={m.channels_heading()}
        values={values}
        tokenLabel={(value) => channelLabel(data.channel(ChannelId.make(value)), value)}
        onChange={(next) => onChange(next.map((value) => ChannelId.make(value)))}
        input={false}
        extra={
          <Select
            quiet
            id={id}
            className="w-44"
            placeholder={m.library_editor_add_channel()}
            value={null}
            options={available.map((channel) => ({ value: channel.id, label: channel.name }))}
            onChange={(next) => onChange([...values, ChannelId.make(next)])}
          />
        }
      />
    </div>
  );
}

/** The preview tree: folders, then up to five items per folder with their day. */
function Tree({
  nodes,
  depth,
  now,
  timeZone,
}: {
  nodes: readonly TreeNode[];
  depth: number;
  now: number;
  timeZone: string | undefined;
}) {
  const indent = ["", "pl-4", "pl-8"][Math.min(depth, 2)];
  return nodes.map((node) => (
    <div key={node.name} className="contents">
      <div
        className={cn(
          "truncate",
          indent,
          depth === 0 ? "pt-1.5 pb-0.5 font-semibold" : "text-fg-2",
          node.other && "text-warn-fg",
        )}
      >
        {node.name}
      </div>
      <Tree nodes={node.children} depth={depth + 1} now={now} timeZone={timeZone} />
      {node.items.slice(0, 5).map((item) => (
        <div key={item.entry.id} className="flex min-w-0 items-center gap-2 pl-12">
          <span className="truncate">{item.name}</span>
          <span className="flex-none text-xs text-fg-3">
            {dayPill(epochMs(item.entry.start), now, timeZone)}
          </span>
        </div>
      ))}
    </div>
  ));
}

const keepChoices: readonly Exclude<KeepChoice, "current">[] = [
  "all",
  "events3",
  "newest10",
  "days30",
];
const keepLabel = (choice: KeepChoice): string =>
  choice === "all"
    ? m.library_keep_everything()
    : choice === "events3"
      ? keepWords({ _tag: "KeepNewestEvents", count: 3 })
      : choice === "newest10"
        ? keepWords({ _tag: "KeepNewest", count: 10 })
        : choice === "days30"
          ? keepWords({ _tag: "KeepDays", days: 30 })
          : m.library_keep_current();

/** The editor once its starting draft is known. */
function EditorForm({
  initial,
  data,
  timeZone,
  editing,
  selectName,
}: {
  initial: CollectionDraft;
  data: LibraryData;
  /**
   * The household's zone: the preview predicts the server's grouping, which counts days in it.
   * Until it is known the form is a skeleton and the preview stays empty.
   */
  timeZone: string | undefined;
  editing: boolean;
  /** Focus the prefilled name with its text selected, so typing replaces it. */
  selectName: boolean;
}) {
  const [draft, setDraft] = useState(initial);
  const [tried, setTried] = useState(false);
  const [advanced, setAdvanced] = useState(() => opensAdvanced(initial));
  const nameRef = useRef<HTMLInputElement | null>(null);
  const save = useSaveCollection();
  const remove = useDeleteCollection();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteCollection = () => {
    const base = draft.base;
    if (base === undefined) return;
    remove.mutate(base.id, {
      onSuccess: () => {
        const title = m.toast_deleted_named({ name: base.name });
        toast({ title });
        announce(title);
        void navigate({ to: "/recordings" });
      },
      onError: () => toast({ title: m.state_not_saved(), type: "error" }),
    });
  };
  const unlink = useUnlinkCollection();
  const follows = draft.base?.follows;
  const navigate = useNavigate();
  const now = useNow(60_000);
  const nameId = useId();
  const keepId = useId();
  useEffect(() => {
    if (!selectName) return;
    nameRef.current?.focus();
    nameRef.current?.select();
  }, [selectName]);
  const set = (patch: Partial<CollectionDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  // The preview runs the domain's grouping over the whole library: once per change of the
  // draft or the answers, not on every render (the clock tick, a menu opening).
  const { recordings, collections, ruleCollection, channel } = data;
  const recorded = useMemo(
    () => recordings.filter((entry) => entry.state !== "scheduled" && entry.state !== "cancelled"),
    [recordings],
  );
  const preview = useMemo(
    () =>
      timeZone === undefined
        ? emptyPreview
        : previewDraft(
            draft,
            recorded,
            collections,
            ruleCollection,
            { timeZone, channelName: (id) => channel(id)?.name },
            pathLabels(),
          ),
    [draft, recorded, collections, ruleCollection, channel, timeZone],
  );
  const nameError = tried && draft.name.trim() === "" ? m.library_editor_name_needed() : undefined;
  const criteriaError =
    tried && !hasCriteria(draft) ? m.library_editor_criteria_needed() : undefined;
  const example = preview.example;
  const marks = example
    ? draft.path.flatMap((part, index): { text: string; tone: 1 | 2 }[] => {
        const text = example.path[index + 1];
        if (text === undefined) return [];
        if (part === "event") return [{ text, tone: 1 }];
        return part === "programme" || part === "subtitle" ? [{ text, tone: 2 }] : [];
      })
    : [];
  const unused = layoutParts.filter((part) => !draft.path.includes(part));
  const submit = () => {
    setTried(true);
    if (!hasCriteria(draft)) setAdvanced(true);
    if (draft.name.trim() === "" || !hasCriteria(draft)) return;
    const input =
      editing && draft.base
        ? { id: draft.base.id, collection: draftToUpdate(draft) }
        : { collection: draftToInput(draft) };
    save.mutate(input, {
      onSuccess: (saved) => {
        const title = editing
          ? m.library_saved({ name: saved.name })
          : m.library_created({ name: saved.name });
        toast({ title });
        announce(title);
        void navigate({ to: "/recordings/c/$group/{-$season}", params: { group: saved.id } });
      },
      onError: (error) => {
        const problem = problemOf(error);
        // It began following a series recording meanwhile: its conditions are not its own.
        toast({
          title:
            problem._tag === "Conflict" && problem.code === "followsRule"
              ? m.library_editor_follows_conflict()
              : m.library_save_failed(),
          type: "error",
        });
      },
    });
  };
  const useOwnConditions = () => {
    const base = draft.base;
    if (base === undefined) return;
    unlink.mutate(base.id, {
      onSuccess: (collection) => {
        // From now on the conditions are the collection's own, starting from today's.
        set({ base: collection });
        const title = m.library_editor_unlinked({ name: collection.name });
        toast({ title });
        announce(title);
      },
      onError: () => toast({ title: m.library_action_failed(), type: "error" }),
    });
  };
  const channelName = (id: ChannelId) => channelLabel(data.channel(id), id);
  return (
    <div className="grid gap-6 pb-24 lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)] lg:items-start lg:gap-10 lg:pb-10">
      <form
        className="min-w-0"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="panel">
          <FormSection title={m.field_name()}>
            <Field
              label={m.field_name()}
              reserve
              htmlFor={nameId}
              {...(nameError ? { error: nameError } : {})}
            >
              <Input
                id={nameId}
                ref={nameRef}
                value={draft.name}
                placeholder={m.library_editor_name_placeholder()}
                aria-invalid={nameError ? true : undefined}
                onChange={(event) => set({ name: event.currentTarget.value })}
              />
            </Field>
            {follows === undefined || draft.base === undefined ? null : (
              <div
                data-follows=""
                className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-md bg-hover px-3.5 py-3 text-[13.5px] text-fg-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
              >
                <Icon icon={LinkIcon} />
                <span className="min-w-0">
                  {m.library_editor_follows({
                    name: follows.ruleName ?? data.ruleName(follows.ruleId) ?? "",
                    summary: followsSummary(draft.base.matcher, channelName),
                  })}
                </span>
                <span className="col-span-2 justify-self-start sm:col-span-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    nativeButton={false}
                    render={<Link to="/series/$id" params={{ id: follows.ruleId }} />}
                  >
                    {m.guide_series_options()}
                  </Button>
                </span>
              </div>
            )}
          </FormSection>
          <FormSection title={m.library_editor_layout()}>
            {example ? (
              <div className="grid gap-1.5">
                <span className="text-[13px] font-semibold">{m.library_editor_example()}</span>
                <p className="rounded-md bg-bg-2 px-3.5 py-3 text-[15px] leading-[2.1] font-medium shadow-[inset_0_0_0_1px_var(--line-2)]">
                  {markTitle(example.entry.title, marks).map((piece, index) => (
                    <span
                      // Pieces of one title in order; the index is their identity.
                      // oxlint-disable-next-line react/no-array-index-key
                      key={index}
                      className={cn(
                        piece.tone === 0 && "text-fg-3",
                        piece.tone !== 0 &&
                          "rounded-[6px] px-1 py-0.75 shadow-[inset_0_-2px_0_currentColor]",
                        piece.tone === 1 && "bg-info/14 text-info",
                        piece.tone === 2 && "bg-ok-soft text-ok-fg",
                      )}
                    >
                      {piece.text}
                    </span>
                  ))}
                </p>
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <span className="text-[13px] font-semibold">{m.library_editor_path()}</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <Token label={draft.name.trim() || m.library_kind_collection()} />
                {draft.path.map((part) => (
                  <span key={part} className="contents">
                    <Icon icon={ChevronRightIcon} size={14} className="text-fg-4" />
                    <Token
                      label={partWords(part)}
                      {...(part === "event"
                        ? { tone: "info" as const }
                        : part === "programme" || part === "subtitle"
                          ? { tone: "ok" as const }
                          : {})}
                      {...(draft.path.length > 1
                        ? { onRemove: () => set({ path: draft.path.filter((p) => p !== part) }) }
                        : {})}
                    />
                  </span>
                ))}
                {unused.length > 0 ? (
                  <ResponsiveMenu
                    name="part"
                    label={m.library_editor_add_part()}
                    align="start"
                    trigger={
                      <Button size="sm" variant="ghost" icon={<Icon icon={AddIcon} size={16} />}>
                        {m.library_editor_add_part()}
                      </Button>
                    }
                  >
                    {unused.map((part: LayoutPart) => (
                      <MenuItem key={part} onSelect={() => set({ path: [...draft.path, part] })}>
                        {partWords(part)}
                      </MenuItem>
                    ))}
                  </ResponsiveMenu>
                ) : null}
              </div>
              <p className="text-[13px] text-fg-2">
                {example
                  ? m.library_editor_becomes({ path: example.path.join(" › ") })
                  : m.library_editor_layout_empty()}
              </p>
            </div>
          </FormSection>
          <FormSection title={m.library_editor_keep()}>
            <Field label={m.library_editor_retention()} htmlFor={keepId}>
              <Select
                id={keepId}
                value={draft.keep}
                options={[
                  ...keepChoices,
                  ...(initial.keep === "current" ? (["current"] as const) : []),
                ].map((choice) => ({ value: choice, label: keepLabel(choice) }))}
                onChange={(keep) => set({ keep })}
              />
            </Field>
          </FormSection>
          {/* "Advanced: what belongs here" (SPEC §8.5): the conditions, under the sections. */}
          <FormDisclosure
            title={m.library_editor_advanced()}
            open={advanced}
            onToggle={() => setAdvanced((open) => !open)}
          >
            <div className="grid gap-4 p-5">
              {follows === undefined ? (
                <>
                  <ChannelField
                    data={data}
                    values={draft.channels}
                    onChange={(channels) => set({ channels })}
                  />
                  <LabelledTokens
                    label={m.library_editor_starts()}
                    values={draft.startsWith}
                    onChange={(startsWith) => set({ startsWith })}
                  />
                  <LabelledTokens
                    label={m.series_kind_category()}
                    values={draft.categories}
                    onChange={(categories) => set({ categories })}
                  />
                  <LabelledTokens
                    label={m.library_editor_label()}
                    values={draft.labels}
                    onChange={(values) => set({ labels: values })}
                  />
                  {criteriaError ? (
                    <p role="alert" className="text-[13px] text-live-fg">
                      {criteriaError}
                    </p>
                  ) : null}
                </>
              ) : (
                <div className="grid justify-items-start gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    busy={unlink.isPending}
                    onClick={useOwnConditions}
                  >
                    {m.library_editor_unlink()}
                  </Button>
                </div>
              )}
              {hasCriteria(draft) && draft.name.trim() !== ""
                ? preview.overlaps.length === 0
                  ? null
                  : preview.overlaps.map((overlap) => (
                      <p key={overlap.name} className="text-[13px] text-warn-fg">
                        {m.library_editor_overlap({ name: overlap.name, count: overlap.count })}
                      </p>
                    ))
                : null}
            </div>
          </FormDisclosure>
        </div>
        <SaveBar>
          <SaveActions
            submit
            label={editing ? m.library_editor_save() : m.library_editor_create()}
            busy={save.isPending}
            cancel={{ to: "/recordings" }}
          >
            {editing && draft.base ? (
              <>
                {/* Under 640 px Delete gives way as an icon. */}
                <Button
                  variant="ghost"
                  className="shrink-0 max-sm:hidden"
                  icon={<Icon icon={DeleteIcon} />}
                  onClick={() => setConfirmDelete(true)}
                >
                  {m.library_delete_collection()}
                </Button>
                <IconButton
                  label={m.library_delete_collection()}
                  className="shrink-0 sm:hidden"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Icon icon={DeleteIcon} />
                </IconButton>
              </>
            ) : null}
          </SaveActions>
        </SaveBar>
        <Dialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          label={m.library_delete_collection_title({ name: draft.base?.name ?? "" })}
          showTitle
          size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                {m.action_cancel()}
              </Button>
              <Button variant="danger" busy={remove.isPending} onClick={deleteCollection}>
                {m.library_delete_collection()}
              </Button>
            </>
          }
        >
          <p className="p-5.5 text-[14px] text-fg-2">{m.library_delete_collection_text()}</p>
        </Dialog>
      </form>
      <aside
        className="panel overflow-hidden lg:sticky lg:top-[calc(var(--nav-h)+24px)] lg:max-h-[calc(100dvh-var(--nav-h)-48px)] lg:overflow-auto"
        aria-label={m.library_editor_preview()}
      >
        <div className="sticky top-0 z-2 flex flex-wrap items-center gap-2.5 border-b border-line bg-surface px-4.5 py-4">
          <span className="type-h3">{m.library_editor_preview()}</span>
          <Badge tone={preview.placed > 0 ? "ok" : "neutral"} className="ml-auto">
            {m.library_editor_placed({ count: preview.placed })}
          </Badge>
        </div>
        {preview.placed > 0 ? (
          <div className="grid gap-0.5 px-4.5 pt-1.5 pb-3.5 text-[13.5px]">
            <Tree nodes={preview.tree} depth={0} now={now} timeZone={timeZone} />
          </div>
        ) : (
          <p className="px-4.5 py-3 text-[13px] text-fg-2">{m.library_editor_nothing()}</p>
        )}
        {preview.elsewhere.length > 0 ? (
          <p className="px-4.5 pb-3.5 text-[13px] text-fg-2">
            {m.library_editor_elsewhere({
              count: preview.elsewhere.length,
              name: preview.elsewhere[0]?.collection ?? "",
            })}
          </p>
        ) : null}
      </aside>
    </div>
  );
}

/**
 * The collection editor (SPEC §8.5) for a new collection (`from`: the key of the group it starts
 * from, "Make it a collection") or an existing one (`id`). Admin only; the live preview uses the domain's real
 * precedence over the whole library.
 */
export function CollectionEditor({ id, from }: { id?: CollectionId; from?: string }) {
  const data = useLibraryData();
  const editing = id !== undefined;
  const base = editing ? data.collections.find((c) => c.id === id) : undefined;
  const loading = data.loading;
  // Known from the last answer while loading, when this browser kept one (SPEC §6.2).
  const known = data.collectionsKnown;
  let initial: CollectionDraft | undefined;
  if (!known) initial = editing ? undefined : emptyDraft;
  else {
    if (base) initial = draftFromCollection(base);
    else if (from !== undefined) {
      const group = groupPage(
        from,
        data.recordings,
        data.collections,
        pathLabels(),
        undefined,
      )?.group;
      initial = group ? draftFromGroup(group) : emptyDraft;
    } else if (!editing) initial = emptyDraft;
  }
  const title = editing ? m.library_edit_collection() : m.library_new_collection();
  const trail: Crumb[] = [
    { label: m.nav_recordings(), link: { to: "/recordings" } },
    { label: m.library_collections() },
  ];
  // The collection is gone (deleted on another device, or a stale link): the screen says so
  // instead of introducing an editor it cannot show.
  if (!loading && data.isAdmin && editing && base === undefined) {
    return (
      <Wrap>
        <Crumbs crumbs={trail} />
        <EmptyState
          page
          title={m.library_collection_missing()}
          action={
            <Button nativeButton={false} render={<Link to="/recordings" />}>
              {m.library_back_to_recordings()}
            </Button>
          }
        />
      </Wrap>
    );
  }
  return (
    <Wrap>
      <Crumbs crumbs={[...trail, { label: base?.name ?? title }]} />
      <header className="flex flex-wrap items-end gap-x-4 gap-y-3 pt-3 pb-5 md:pb-6">
        <h1 className="type-h1 mr-auto">{title}</h1>
      </header>
      <LoadingScope loading={loading}>
        {!loading && !data.isAdmin ? (
          <EmptyState
            title={m.library_editor_admin_only()}
            action={
              <Button nativeButton={false} render={<Link to="/recordings" />}>
                {m.library_back_to_recordings()}
              </Button>
            }
          />
        ) : initial ? (
          <EditorForm
            // Drawn from the kept answer while loading, then once more from the server's: a
            // collection may have started (or stopped) following a series recording meanwhile.
            key={editing || from !== undefined ? (loading ? "kept" : "loaded") : "new"}
            initial={initial}
            data={data}
            timeZone={data.timeZone}
            editing={editing}
            selectName={!editing && initial.name !== ""}
          />
        ) : (
          <div className="panel h-150" />
        )}
      </LoadingScope>
    </Wrap>
  );
}
