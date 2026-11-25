import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import {
  canEditRule,
  type Channel,
  type ChannelId,
  type Collection,
  draftExtraTime,
  draftProblems,
  type ExtraTimeDefaults,
  goesToView,
  pickableChannels,
  previewInput,
  previewUntil,
  recordedCount,
  type Rule,
  type RuleDraft,
  type SeriesDraft,
  toRuleInput,
  toRuleUpdate,
} from "@slipstream/domain";
import { m, pathLabels } from "@slipstream/i18n";
import { problemOf } from "~/api/errors.ts";
import { useQueries } from "~/api/hooks.ts";
import { useDeleteRule, useSaveRule } from "~/api/mutations.ts";
import type { Viewer } from "~/api/viewer.ts";
import { Icon } from "~/ui/icon.tsx";
import { DeleteIcon, InfoIcon } from "~/ui/icons.ts";
import { Button } from "~/ui/primitives/button.tsx";
import { useIsLoading } from "~/ui/skeleton-state.ts";
import { toast } from "~/ui/toast-manager.ts";
import { useDebouncedValue } from "~/ui/use-debounced-value.ts";
import { FormDisclosure } from "~/ui/disclosure.tsx";
import { useNow } from "~/ui/use-now.ts";
import { type PreviewState, SeriesPreview } from "../series-preview.tsx";
import { ConditionsSection } from "./conditions.tsx";
import { DeleteDialog } from "./delete-confirm.tsx";
import { EpisodesSection } from "./episodes.tsx";
import { ExtraTimeSection } from "./extra-time-section.tsx";
import { GoesToSection } from "./goes-to.tsx";
import { NameChannelsSection } from "./name-channels.tsx";
import { SeriesSaveBar } from "./save-bar.tsx";
import { WhenSection } from "./when.tsx";

/** Everything the editor reads, loaded by the page around it (`SeriesEditorPage`). */
export interface EditorData {
  readonly rule: Rule | undefined;
  readonly channels: readonly Channel[];
  readonly collections: readonly Collection[];
  readonly viewer: Viewer;
  readonly ownerName: string;
  readonly adminName: string | undefined;
  readonly defaults: ExtraTimeDefaults;
  /** The household's zone the preview counts days in; undefined while it loads. */
  readonly timeZone: string | undefined;
  /** May create and change collections, so link one and choose what deleting does to it. */
  readonly mayEditCollections: boolean;
  /** How many deleted episodes it keeps out for the viewer. */
  readonly history: number;
}

/** A channel name's usual length, drawn (transparent) under the skeleton while channels load. */
const placeholderChannelName = "Channel name";

/**
 * The series recording editor (SPEC §8.6, recording model §3.2): the plain-language summary on
 * top, six sections, the sticky preview, and the save bar that states the effect. The draft and
 * what it previews and saves live here; each section draws its part (./*.tsx).
 */
export function SeriesEditor({ initial, data }: { initial: SeriesDraft; data: EditorData }) {
  const { rule, channels, collections, viewer, defaults, timeZone } = data;
  const queries = useQueries();
  const navigate = useNavigate();
  const { access } = viewer;
  const now = useNow();
  const save = useSaveRule();
  const remove = useDeleteRule();
  // What the saved series recording holds; grouping it in a collection changes it in place.
  const [baseline, setBaseline] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [showProblems, setShowProblems] = useState(false);
  const [saveProblem, setSaveProblem] = useState<string | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [until] = useState(() => previewUntil(Date.now()));
  const nameRef = useRef<HTMLInputElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const editable = rule === undefined || canEditRule(rule, viewer);
  const isNew = rule === undefined;

  const update = (patch: Partial<SeriesDraft>) => setDraft((current) => ({ ...current, ...patch }));
  // While the channels load, a name-sized stand-in under the skeleton, never a long raw id.
  const loadingPage = useIsLoading();
  const channelName = (id: ChannelId) =>
    channels.find((channel) => channel.id === id)?.name ??
    (loadingPage ? placeholderChannelName : undefined);

  // One resolver for the hint and the steppers (open issue 1).
  const extra = draftExtraTime(defaults, draft);
  // Folded unless there is something to act on there (an offer to group, a linked collection).
  const [optionsPicked, setOptionsOpen] = useState<boolean | undefined>(undefined);
  const input = toRuleInput(draft, extra.fallback.padding);
  const problems = draftProblems(draft);
  const blocksPreview = problems.some((problem) => problem.field !== "name");

  // The preview asks once typing pauses. Compared by its JSON, so a draft equal to the last one
  // (a change undone) asks nothing new; the object is the one it was settled from.
  const wanted = previewInput(input, m.series_new());
  const wantedJson = JSON.stringify(wanted);
  const askedJson = useDebouncedValue(wantedJson, 250);
  const [settledDraft, setSettledDraft] = useState({ json: wantedJson, draft: wanted });
  if (askedJson !== settledDraft.json && askedJson === wantedJson) {
    setSettledDraft({ json: wantedJson, draft: wanted });
  }
  const asked: RuleDraft = settledDraft.draft;
  const preview = useQuery({
    ...queries.rulePreview(asked, until),
    enabled: !blocksPreview,
  });
  const previewState: PreviewState = blocksPreview
    ? { kind: "waiting" }
    : timeZone === undefined
      ? { kind: "loading" }
      : preview.data !== undefined
        ? { kind: "ready", preview: preview.data, timeZone }
        : preview.isError
          ? { kind: "failed" }
          : { kind: "loading" };
  const matches = blocksPreview ? [] : (preview.data?.matches ?? []);
  const willRecord = recordedCount(matches);
  // What "Goes to" shows (§3.3, §3.4), as every client works it out: where Automatic lands,
  // the collection following this series recording, what may be picked, the "Group them?" offer.
  const goes = goesToView({
    ruleId: rule?.id,
    collectionId: draft.collectionId,
    collections,
    access,
    mayCreateCollections: data.mayEditCollections,
    preview: blocksPreview ? undefined : preview.data,
    labels: pathLabels(),
  });
  const { following, offer } = goes;
  const mayGroup =
    rule !== undefined && rule.collectionId === undefined && editable && data.mayEditCollections;

  const done = () => {
    toast({
      title: isNew ? m.series_created() : m.series_saved(),
    });
    void navigate({ to: "/series" });
  };
  const failed = (error: unknown) =>
    setSaveProblem(
      problemOf(error)._tag === "Offline" ? m.series_problem_offline() : m.series_problem_generic(),
    );

  const onSave = () => {
    if (problems.length > 0) {
      setShowProblems(true);
      if (problems.some((problem) => problem.field === "name")) nameRef.current?.focus();
      return;
    }
    setSaveProblem(undefined);
    if (rule === undefined) save.mutate({ rule: input }, { onSuccess: done, onError: failed });
    else
      save.mutate(
        { id: rule.id, update: toRuleUpdate(draft, baseline, extra.fallback.padding) },
        { onSuccess: done, onError: failed },
      );
  };

  /**
   * Asks before deleting: in the save bar, or, when a collection follows it and the viewer may
   * change collections, in a dialog that asks what happens to that collection (§3.4).
   */
  const askDelete = () => {
    if (following !== undefined && data.mayEditCollections) setDeleteDialog(true);
    else setConfirmDelete(true);
  };

  const onDelete = (collection: "keep" | "remove") => {
    if (rule === undefined) return;
    // The collection stays (with today's conditions) unless removing it was chosen.
    const kept = following !== undefined && collection === "keep" ? following.name : undefined;
    remove.mutate(following === undefined ? { id: rule.id } : { id: rule.id, collection }, {
      onSuccess: () => {
        toast({
          title: m.series_deleted(),
          ...(kept === undefined ? {} : { description: m.series_kept_collection({ name: kept }) }),
        });
        void navigate({ to: "/series" });
      },
      onError: () => setSaveProblem(m.series_problem_generic()),
    });
  };

  const optionsOpen = optionsPicked ?? (offer !== undefined || following !== undefined);
  return (
    <div className="grid gap-6 pb-[calc(var(--save-h)+24px)] max-lg:short:pb-18 lg:grid-cols-[minmax(0,1fr)_minmax(380px,460px)] lg:items-start lg:gap-10 lg:pb-10">
      <div className="min-w-0">
        {/* Not a <form>: the inline New collection step is its own form inside it. */}
        <div className="panel">
          {/*
            A collection follows this series recording, and this person may not change
            collections: saving changed conditions unlinks it first (§3.4), said before saving.
          */}
          {following !== undefined && !data.mayEditCollections && editable ? (
            <p
              data-linked-notice=""
              className="flex items-start gap-2.5 rounded-t-[inherit] border-b border-line bg-hover px-5 py-3 text-[13.5px] text-fg-2"
            >
              <Icon icon={InfoIcon} size={16} className="mt-0.5 shrink-0" />
              <span className="min-w-0">
                {m.series_linked_notice({ collection: following.name })}
              </span>
            </p>
          ) : null}
          <fieldset disabled={!editable} className="contents">
            <NameChannelsSection
              draft={draft}
              update={update}
              editable={editable}
              nameRef={nameRef}
              nameProblem={showProblems && problems.some((problem) => problem.field === "name")}
              pickable={pickableChannels(channels, access).filter(
                (channel) => !draft.channels.includes(channel.id),
              )}
              channelName={channelName}
            />
            <ConditionsSection
              draft={draft}
              update={update}
              editable={editable}
              problems={problems}
              showProblems={showProblems}
            />
            <WhenSection draft={draft} update={update} editable={editable} />
            <FormDisclosure
              title={m.action_options()}
              open={optionsOpen}
              onToggle={() => setOptionsOpen(!optionsOpen)}
              summary={[
                m.rec_early_value({ minutes: extra.padding.beforeMinutes }),
                m.rec_late_value({ minutes: extra.padding.afterMinutes }),
                draft.skipRepeats ? m.series_episodes_new() : m.series_episodes_every(),
                collections.find((collection) => collection.id === draft.collectionId)?.name ??
                  m.series_automatic(),
              ].join(" · ")}
            >
              <ExtraTimeSection extra={extra} update={update} editable={editable} />
              <EpisodesSection
                draft={draft}
                update={update}
                ruleId={rule?.id}
                history={data.history}
              />
              <GoesToSection
                draft={draft}
                update={update}
                editable={editable}
                options={goes.options}
                allowed={goes.allowed}
                automaticName={goes.automaticName}
                offer={offer}
                following={following}
                groupRuleId={mayGroup ? rule.id : undefined}
                firstMatch={matches.find((match) => match.skip === undefined)?.programme}
                channelName={channelName}
                onLinked={(collectionId) => {
                  setBaseline((current) => ({ ...current, collectionId }));
                  update({ collectionId });
                }}
              />
            </FormDisclosure>
          </fieldset>
        </div>

        {isNew || !editable ? null : (
          // The save bar has no room for Delete on phones; it sits under the form there.
          <div className="mt-4 sm:hidden">
            <Button variant="ghost" icon={<Icon icon={DeleteIcon} />} onClick={askDelete}>
              {m.series_delete_yes()}
            </Button>
          </div>
        )}

        <SeriesSaveBar
          isNew={isNew}
          editable={editable}
          ownerName={data.ownerName}
          count={willRecord}
          busy={save.isPending}
          deleting={remove.isPending}
          confirmDelete={confirmDelete}
          deleteRef={deleteRef}
          onAskDelete={askDelete}
          onConfirmDelete={setConfirmDelete}
          onSave={onSave}
          // Without the question, a collection that follows it stays (§3.4).
          onDelete={() => onDelete("keep")}
          problem={saveProblem}
        />
        {rule !== undefined && following !== undefined ? (
          <DeleteDialog
            open={deleteDialog}
            onOpenChange={setDeleteDialog}
            name={rule.name}
            collection={following.name}
            busy={remove.isPending}
            onDelete={onDelete}
            returnFocus={deleteRef}
          />
        ) : null}
      </div>

      <aside
        id="rule-preview"
        aria-label={m.series_preview()}
        className="panel scroll-mt-[calc(var(--nav-h)+16px)] overflow-hidden lg:sticky lg:top-[calc(var(--nav-h)+24px)] lg:max-h-[calc(100dvh-var(--nav-h)-48px)] lg:overflow-auto"
      >
        <SeriesPreview
          state={previewState}
          conditions={asked.matcher.title}
          isNew={isNew}
          channelName={channelName}
          now={now}
        />
      </aside>
    </div>
  );
}
