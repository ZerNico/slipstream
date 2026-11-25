import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { formatClock } from "~/i18n/formats.ts";
import { m } from "@slipstream/i18n";
import { ks } from "@slipstream/i18n/kitchen-sink";
import { Artwork, ChannelLogo, SourceBadge } from "~/ui/artwork/artwork.tsx";
import { Badge, Chip, Field, SearchField, Segmented } from "~/ui/controls.tsx";
import { Dialog } from "~/ui/dialog.tsx";
import { Icon } from "~/ui/icon.tsx";
import {
  AddIcon,
  EditIcon,
  FilterIcon,
  MoreIcon,
  PlayIcon,
  RecordIcon,
  WarningIcon,
} from "~/ui/icons.ts";
import { MediaCard, MediaRow } from "~/ui/media-row.tsx";
import {
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  ResponsiveMenu,
} from "~/ui/menu.tsx";
import { useOverlay, useOverlayBinding } from "~/ui/overlay/use-overlay.tsx";
import { PageHeader, Section, Toolbar, Wrap } from "~/ui/page.tsx";
import { Button, IconButton } from "~/ui/primitives/button.tsx";
import { Checkbox } from "~/ui/primitives/checkbox.tsx";
import { Input } from "~/ui/primitives/input.tsx";
import { Switch } from "~/ui/primitives/switch.tsx";
import { Sheet } from "~/ui/sheet/sheet.tsx";
import { LoadingScope, Sk } from "~/ui/skeleton.tsx";
import { EmptyState, ProblemCard } from "~/ui/states.tsx";
import { Timeline } from "~/ui/timeline/timeline.tsx";
import { toast } from "~/ui/toast-manager.ts";
import { useNow } from "~/ui/use-now.ts";
import { WatchChoice } from "~/ui/watch-choice/watch-choice.tsx";
import { sampleArtwork, sampleTimelines } from "./kitchen-sink-data.ts";
import { FormatsAndLanguage, IconGallery, MoreParts } from "./kitchen-sink-extras.tsx";
import { MINUTE } from "@slipstream/domain";

/**
 * Every shared component on one page (dev builds only): the reference for screens and the page
 * the layout screenshots and layout-shift checks run against.
 */
export function KitchenSink() {
  const now = useNow(1000);
  const overlay = useOverlay();
  const sheet = useOverlayBinding("sheet", "demo");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"timeline" | "channels">("timeline");
  const [chips, setChips] = useState({ all: true, unwatched: false });
  const [theme, setTheme] = useState("system");
  const [dialog, setDialog] = useState<"md" | "sm" | null>(null);
  const [choice, setChoice] = useState(false);
  const [checked, setChecked] = useState(true);
  const timelines = sampleTimelines(now);
  const [seek, setSeek] = useState<number | null>(null);
  const behind = timelines["behind"];
  const qualifying = sampleArtwork[0];
  if (!behind || !qualifying) return null;
  const position = seek ?? behind.playhead ?? behind.start;

  return (
    <>
      {/* The loading toggle sits outside the scope: inside it, controls ignore the pointer. */}
      <Wrap>
        <PageHeader
          title={ks.title()}
          actions={
            <Button onClick={() => setLoading((value) => !value)}>
              {loading ? ks.loading_off() : ks.loading_on()}
            </Button>
          }
          sub={ks.sub()}
        />
      </Wrap>
      <LoadingScope loading={loading}>
        <Wrap>
          <Section title={ks.buttons()}>
            <div className="grid gap-4">
              <Toolbar aria-label={ks.buttons()}>
                <Button variant="primary" icon={<Icon icon={PlayIcon} />}>
                  {ks.variant_primary()}
                </Button>
                <Button variant="secondary">{ks.variant_secondary()}</Button>
                <Button variant="ghost">{ks.variant_ghost()}</Button>
                <Button variant="danger">{ks.variant_danger()}</Button>
                <Button variant="live" icon={<Icon icon={RecordIcon} />}>
                  {ks.variant_live()}
                </Button>
                <Button disabled>{ks.variant_disabled()}</Button>
                <Button
                  variant="primary"
                  busy={busy}
                  onClick={() => {
                    setBusy(true);
                    window.setTimeout(() => setBusy(false), 1500);
                  }}
                >
                  {ks.variant_busy()}
                </Button>
              </Toolbar>
              <Toolbar aria-label={ks.sizes()}>
                <Button size="sm">{ks.size_sm()}</Button>
                <Button size="md">{ks.size_md()}</Button>
                <Button size="lg" variant="primary">
                  {ks.size_lg()}
                </Button>
                <IconButton label={ks.size_sm()} size="sm" variant="outline">
                  <Icon icon={EditIcon} size={16} />
                </IconButton>
                <IconButton label={ks.size_md()} variant="outline">
                  <Icon icon={MoreIcon} />
                </IconButton>
                <IconButton label={ks.size_lg()} size="lg" variant="outline">
                  <Icon icon={AddIcon} />
                </IconButton>
                <IconButton label={ks.pressed()} pressed>
                  <Icon icon={FilterIcon} />
                </IconButton>
              </Toolbar>
              <div className="flex flex-wrap gap-4 rounded-lg bg-bg p-4" data-surface="cine">
                <Button variant="glass" icon={<Icon icon={PlayIcon} />}>
                  {ks.variant_glass()}
                </Button>
                <IconButton label={m.player_watch_live()} variant="glass" size="lg">
                  <Icon icon={RecordIcon} />
                </IconButton>
              </div>
            </div>
          </Section>

          <Section title={ks.controls()}>
            <div className="grid gap-4">
              <Toolbar aria-label={ks.controls()}>
                <SearchField
                  placeholder={m.recordings_search()}
                  aria-label={m.recordings_search()}
                  className="w-72"
                />
                <Segmented
                  label={ks.view()}
                  value={view}
                  onChange={setView}
                  segments={[
                    { value: "timeline", label: ks.view_timeline() },
                    { value: "channels", label: ks.view_channels() },
                  ]}
                />
                <Chip
                  pressed={chips.all}
                  onPressedChange={(all) => setChips((c) => ({ ...c, all }))}
                >
                  {m.recordings_filter_all()}
                </Chip>
                <Chip
                  pressed={chips.unwatched}
                  onPressedChange={(unwatched) => setChips((c) => ({ ...c, unwatched }))}
                  count={4}
                >
                  {m.recordings_filter_unwatched()}
                </Chip>
                <ResponsiveMenu
                  name="ks-menu"
                  label={ks.menu()}
                  trigger={<Button icon={<Icon icon={MoreIcon} />}>{ks.menu()}</Button>}
                >
                  <MenuItem
                    icon={<Icon icon={EditIcon} />}
                    onSelect={() => toast({ title: ks.menu() })}
                  >
                    {ks.menu_item()}
                  </MenuItem>
                  <MenuSeparator />
                  <MenuLabel>{m.theme_label()}</MenuLabel>
                  <MenuRadioGroup value={theme} onValueChange={setTheme}>
                    <MenuRadioItem value="system">{m.theme_system()}</MenuRadioItem>
                    <MenuRadioItem value="light">{m.theme_light()}</MenuRadioItem>
                    <MenuRadioItem value="dark">{m.theme_dark()}</MenuRadioItem>
                  </MenuRadioGroup>
                </ResponsiveMenu>
              </Toolbar>
              <div className="grid max-w-md gap-4">
                <Field label={ks.field()} hint={ks.field_hint()} htmlFor="ks-name">
                  <Input id="ks-name" placeholder={ks.field_placeholder()} />
                </Field>
                <Field label={ks.field()} error={ks.field_error()} htmlFor="ks-bad">
                  <Input id="ks-bad" aria-invalid />
                </Field>
                <label className="flex items-center gap-3">
                  <Switch checked={checked} onCheckedChange={setChecked} />
                  {ks.switch()}
                </label>
                <label className="flex items-center gap-3">
                  <Checkbox checked={checked} onCheckedChange={setChecked} />
                  {ks.checkbox()}
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone="live">{m.status_live()}</Badge>
                <Badge tone="rec">{m.status_rec()}</Badge>
                <Badge tone="sched">{m.status_scheduled()}</Badge>
                <Badge tone="warn">{m.status_conflict()}</Badge>
                <Badge tone="ok">{ks.badge_ok()}</Badge>
                <Badge tone="neutral">{m.status_new()}</Badge>
                <ChannelLogo mark="ZDF" size="sm" />
                <ChannelLogo mark="arte" />
                <ChannelLogo mark="KiKA" size="lg" />
              </div>
            </div>
          </Section>

          <Section title={ks.overlays()}>
            <Toolbar aria-label={ks.overlays()}>
              <Button onClick={() => overlay.open({ kind: "sheet", name: "demo" })}>
                {ks.open_sheet()}
              </Button>
              <Button onClick={() => setDialog("md")}>{ks.open_dialog()}</Button>
              <Button onClick={() => setDialog("sm")}>{ks.open_small_dialog()}</Button>
              <Button variant="primary" onClick={() => setChoice(true)}>
                {ks.open_choice()}
              </Button>
              <Button onClick={() => overlay.open({ kind: "dlg", name: "cmdk" })}>
                {ks.open_palette()}
              </Button>
              <Button
                onClick={() =>
                  toast({
                    title: ks.toast_title(),
                    description: ks.toast_text(),
                    undo: () => toast({ title: ks.toast_undone() }),
                  })
                }
              >
                {ks.show_toast()}
              </Button>
            </Toolbar>
          </Section>

          <MoreParts />

          <Section title={ks.timeline()}>
            <div className="grid max-w-3xl gap-6">
              <Timeline
                data={{ ...behind, playhead: position }}
                onSeek={setSeek}
                label={qualifying.title}
              />
              <Timeline data={timelines["live"] ?? behind} />
              <Timeline data={timelines["startsSoon"] ?? behind} />
              <Timeline
                data={timelines["resumeNearStart"] ?? behind}
                variant="compact"
                caption={ks.caption()}
              />
              <Timeline data={timelines["finished"] ?? behind} relative variant="compact" />
            </div>
          </Section>

          <Section title={ks.artwork()}>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {sampleArtwork.map((subject) => (
                <div key={subject.title} className="grid gap-2">
                  <Artwork subject={subject} />
                  <span className="type-meta truncate">
                    <Sk>{subject.title}</Sk>
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <SourceBadge source={{ kind: "frame", url: "", grabbedAt: now - 32 * MINUTE }} />
              <SourceBadge source={{ kind: "guide", url: "" }} />
              <SourceBadge source={{ kind: "generated" }} />
            </div>
          </Section>

          <IconGallery />

          <FormatsAndLanguage now={now} />

          <Section title={ks.rows()} more={{ label: m.action_see_all(), to: "/recordings" }}>
            <MediaRow label={ks.rows()}>
              {sampleArtwork.map((subject, index) => (
                <MediaCard
                  key={subject.title}
                  art={<Artwork subject={subject} />}
                  title={subject.title}
                  subtitle={formatClock(now - index * 37 * MINUTE)}
                  progress={index % 3 === 0 ? 0.4 : undefined}
                  live={index === 0}
                  isNew={index === 2}
                  badges={index === 0 ? <Badge tone="live">{m.status_live()}</Badge> : undefined}
                  render={({ className, children }) => (
                    <Link to="/dev/kitchen-sink" className={className}>
                      {children}
                    </Link>
                  )}
                />
              ))}
            </MediaRow>
          </Section>

          <Section title={ks.states()}>
            <div className="grid gap-4 md:grid-cols-2">
              <ProblemCard
                tone="err"
                title={ks.problem_title()}
                text={ks.problem_text()}
                actions={
                  <Button size="sm" variant="primary">
                    {m.source_test()}
                  </Button>
                }
                onDismiss={() => toast({ title: ks.toast_title(), undo: () => undefined })}
              />
              <ProblemCard
                tone="warn"
                icon={WarningIcon}
                title={ks.conflict_title()}
                text={ks.conflict_text()}
              />
              <EmptyState
                title={m.recordings_empty()}
                text={m.recordings_empty_hint()}
                action={<Button variant="primary">{m.nav_guide()}</Button>}
              />
            </div>
          </Section>
        </Wrap>
      </LoadingScope>

      <Sheet
        open={sheet.open}
        onOpenChange={sheet.onOpenChange}
        label={qualifying.title}
        context={ks.sheet_context()}
        art={<Artwork subject={qualifying} noTitle />}
        footer={
          <>
            <Button size="lg" variant="primary" icon={<Icon icon={PlayIcon} />}>
              {m.player_watch()}
            </Button>
            <Button size="lg" variant="ghost">
              {ks.series_options()}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 p-5">
          <div className="flex gap-2">
            <Badge tone="live">{m.status_live()}</Badge>
            <Badge tone="rec">{m.status_rec()}</Badge>
          </div>
          <h2 className="type-h2">{qualifying.title}</h2>
          <p className="type-meta" data-half="">
            {ks.sheet_facts()}
          </p>
          <Timeline
            data={{ ...behind, playhead: position }}
            variant="compact"
            caption={ks.caption()}
          />
          {Array.from({ length: 6 }, (_, index) => (
            <p key={index} className="text-fg-2">
              {ks.sheet_text()}
            </p>
          ))}
        </div>
      </Sheet>

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        label={ks.dialog_title()}
        showTitle
        size={dialog ?? "md"}
        footer={
          <>
            <Button onClick={() => setDialog(null)}>{m.action_cancel()}</Button>
            <Button variant="primary" onClick={() => setDialog(null)}>
              {m.action_save()}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 p-5.5">
          <p className="text-fg-2">{ks.dialog_text()}</p>
          <Field label={ks.field()} htmlFor="ks-dialog-name">
            <Input id="ks-dialog-name" placeholder={ks.field_placeholder()} />
          </Field>
        </div>
      </Dialog>

      <WatchChoice
        open={choice}
        onOpenChange={setChoice}
        title={qualifying.title}
        subtitle={ks.choice_sub()}
        artwork={qualifying}
        input={{
          windowStart: behind.start,
          windowEnd: behind.end,
          live: true,
          now,
          resumeAt: position,
        }}
        timeline={{ ...behind, playhead: position, bands: [] }}
        onPick={(option) => {
          setChoice(false);
          toast({ title: ks.picked({ kind: option.kind }) });
        }}
      />
    </>
  );
}
