/**
 * Expo config plugin: lets the phone open a TV's sign-in QR code in the app.
 *
 * The QR code holds the server's approve page, `https://<server>/link?code=QK74RM`. Every
 * server has its own address, so a published APK cannot claim them all. Two ways in:
 *
 * - The `slipstream://link?code=QK74RM` scheme (from `scheme` in app.json) always works; the
 *   web approve page can hand off to it when the app is installed.
 * - For a build aimed at known servers, `SLIPSTREAM_LINK_HOSTS` (comma separated, e.g.
 *   `tv.example.com,slipstream.home`) adds Android App Link filters for `/link` on those hosts.
 *   They verify against the server's `/.well-known/assetlinks.json`; until they do, Android
 *   asks once which app should open the link.
 *
 * Without the variable the manifest is left as it is.
 */
const { AndroidConfig, withAndroidManifest } = require("expo/config-plugins");

const LINK_PATH = "/link";

/** Host names from a comma separated list, trimmed and without duplicates or empty entries. */
const parseHosts = (value) => [
  ...new Set(
    (value ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host !== "" && /^[a-z0-9.-]+$/u.test(host)),
  ),
];

/** One verified intent filter for the approve page on the given hosts. */
const linkFilter = (hosts) => ({
  $: { "android:autoVerify": "true" },
  action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
  category: [
    { $: { "android:name": "android.intent.category.DEFAULT" } },
    { $: { "android:name": "android.intent.category.BROWSABLE" } },
  ],
  data: [
    { $: { "android:scheme": "https" } },
    { $: { "android:scheme": "http" } },
    ...hosts.map((host) => ({ $: { "android:host": host } })),
    { $: { "android:pathPrefix": LINK_PATH } },
  ],
});

const isLinkFilter = (filter) =>
  (filter.data ?? []).some((data) => data.$?.["android:pathPrefix"] === LINK_PATH);

/** Adds (or replaces) the approve-page filter on the main activity; no hosts, no change. */
const addLinkFilter = (manifest, hosts) => {
  if (hosts.length === 0) return manifest;
  const activity = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
  const others = (activity["intent-filter"] ?? []).filter((filter) => !isLinkFilter(filter));
  activity["intent-filter"] = [...others, linkFilter(hosts)];
  return manifest;
};

const withDeviceLink = (config) =>
  withAndroidManifest(config, (mod) => {
    mod.modResults = addLinkFilter(mod.modResults, parseHosts(process.env.SLIPSTREAM_LINK_HOSTS));
    return mod;
  });

module.exports = withDeviceLink;
module.exports.parseHosts = parseHosts;
module.exports.addLinkFilter = addLinkFilter;
