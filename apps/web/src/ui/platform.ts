/** What platform detection reads from `navigator`. */
interface PlatformSource {
  readonly platform?: string;
  readonly userAgent?: string;
  readonly userAgentData?: { readonly platform?: string };
}

const browser = (): PlatformSource | undefined =>
  typeof navigator === "undefined" ? undefined : navigator;

/**
 * Whether the reader is on an Apple platform (macOS, iOS, iPadOS), where the command key is ⌘;
 * everywhere else shortcuts take Ctrl. Read from the browser, so a hint names the key the
 * reader's keyboard actually has.
 */
export const isApplePlatform = (source: PlatformSource | undefined = browser()): boolean => {
  if (source === undefined) return false;
  const platform = source.userAgentData?.platform ?? source.platform ?? "";
  return (
    /mac|iphone|ipad|ipod/iu.test(platform) || /iphone|ipad|ipod/iu.test(source.userAgent ?? "")
  );
};
