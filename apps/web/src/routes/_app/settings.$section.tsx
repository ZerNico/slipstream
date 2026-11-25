import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { isSettingsSection, visibleSections } from "~/modules/settings/sections.ts";
import { SettingsPage } from "~/modules/settings/settings-page.tsx";

/**
 * A settings section (SPEC §8.7): `device` and `profile` for everyone; the household's sources,
 * recording, users, playback (Default quality) and storage for the admin. Unknown sections are
 * a 404; a household section opened by someone else goes to This device.
 */
export const Route = createFileRoute("/_app/settings/$section")({
  beforeLoad: ({ context, params }) => {
    if (!isSettingsSection(params.section)) throw notFound();
    if (!visibleSections(context.me.role).includes(params.section)) {
      throw redirect({ to: "/settings/$section", params: { section: "device" }, replace: true });
    }
  },
  component: Page,
});

function Page() {
  const { section } = Route.useParams();
  const { me } = Route.useRouteContext();
  return isSettingsSection(section) ? <SettingsPage section={section} me={me} /> : null;
}
