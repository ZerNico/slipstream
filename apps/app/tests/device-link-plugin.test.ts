import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

interface Element {
  $?: Record<string, string>;
  [child: string]: unknown;
}

interface Plugin {
  readonly parseHosts: (value: string | undefined) => readonly string[];
  readonly addLinkFilter: (manifest: unknown, hosts: readonly string[]) => unknown;
}

const plugin = createRequire(import.meta.url)("../plugins/with-device-link.cjs") as Plugin;

/** A manifest shaped like the one prebuild generates: one launcher activity with the scheme. */
const manifest = () => ({
  manifest: {
    application: [
      {
        $: { "android:name": ".MainApplication" },
        activity: [
          {
            $: { "android:name": ".MainActivity" },
            "intent-filter": [
              {
                action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
                data: [{ $: { "android:scheme": "slipstream" } }],
              },
            ],
          },
        ],
      },
    ],
  },
});

const filtersOf = (value: unknown): Element[] => {
  const root = value as { manifest: { application: { activity: Element[] }[] } };
  return root.manifest.application[0]?.activity[0]?.["intent-filter"] as Element[];
};

describe("with-device-link", () => {
  it("reads a comma separated host list and drops junk", () => {
    expect(plugin.parseHosts(undefined)).toEqual([]);
    expect(plugin.parseHosts(" TV.example.com, ,slipstream.home,tv.example.com,bad/host")).toEqual([
      "tv.example.com",
      "slipstream.home",
    ]);
  });

  it("leaves the manifest alone without hosts", () => {
    expect(filtersOf(plugin.addLinkFilter(manifest(), []))).toHaveLength(1);
  });

  it("adds one verified /link filter for the hosts, once", () => {
    const once = plugin.addLinkFilter(manifest(), ["tv.example.com"]);
    const twice = plugin.addLinkFilter(once, ["tv.example.com", "slipstream.home"]);
    const filters = filtersOf(twice);
    expect(filters).toHaveLength(2);
    const link = filters[1];
    expect(link?.$).toEqual({ "android:autoVerify": "true" });
    expect(link?.data).toEqual([
      { $: { "android:scheme": "https" } },
      { $: { "android:scheme": "http" } },
      { $: { "android:host": "tv.example.com" } },
      { $: { "android:host": "slipstream.home" } },
      { $: { "android:pathPrefix": "/link" } },
    ]);
  });
});
