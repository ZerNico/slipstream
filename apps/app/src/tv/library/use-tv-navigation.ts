import { useFocusEffect, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { BackHandler } from "react-native";
import { groupHref } from "../../routes.ts";

/** How long a screen keeps asking for focus once it shows, before it lets go of the request. */
const SETTLE_MS = 400;

/**
 * Where focus goes when a screen shows (Infuse, Plex): the first time, the screen's own first
 * choice (`first`); after a page, the player or a sheet over it, back to what OK opened
 * (`opening`), when it is still among `keys`. `target` names that item for a moment after the
 * screen shows (`hasTVPreferredFocus` turning true asks for focus), and nothing while another
 * screen or a sheet (`covered`) is over it, so a hidden screen never takes focus and the request
 * can be made again when it shows. Afterwards nothing asks, so refreshed data never pulls focus
 * away from where the viewer is.
 */
export const useReturnFocus = ({
  keys,
  first,
  covered = false,
}: {
  /** The focusable items' keys on screen now. */
  readonly keys: readonly string[];
  /** The screen's own first choice, when nothing was opened from it. */
  readonly first: string | undefined;
  /** A sheet is over the screen. */
  readonly covered?: boolean;
}) => {
  const [opened, setOpened] = useState<string | undefined>(undefined);
  const [away, setAway] = useState(false);
  const [pending, setPending] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setAway(false);
      setPending(true);
      return () => setAway(true);
    }, []),
  );
  // A sheet closing hands focus back as a page closing does.
  const [wasCovered, setWasCovered] = useState(covered);
  if (covered !== wasCovered) {
    setWasCovered(covered);
    if (!covered) setPending(true);
  }
  const target =
    away || covered || !pending
      ? undefined
      : opened !== undefined && keys.includes(opened)
        ? opened
        : first;
  useEffect(() => {
    if (target === undefined) return undefined;
    const timer = setTimeout(() => setPending(false), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [target]);
  return {
    target,
    opening: setOpened,
    /** Hands focus to `key` now: the button that had it can no longer take it (disabled). */
    focus: (key: string) => {
      setOpened(key);
      setPending(true);
    },
  };
};

/**
 * Back from a page of the Recordings tab's stack on TV. Opened from the library, Back pops to
 * it. Opened from another tab (Home's rows), the page is the stack's only screen: Back returns
 * to that tab, and the stack is reset to the library, so the rail's Recordings opens the library
 * next time rather than this page. Delete leaves the page the same way.
 */
export const useTvBack = () => {
  const router = useRouter();
  const navigation = useNavigation();
  const back = useCallback(() => {
    const root = navigation.getState()?.index === 0;
    router.back();
    if (root) navigation.dispatch({ type: "REPLACE", payload: { name: "index" } });
  }, [navigation, router]);
  useFocusEffect(
    useCallback(() => {
      if (navigation.getState()?.index !== 0) return undefined;
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        back();
        return true;
      });
      return () => subscription.remove();
    }, [navigation, back]),
  );
  return back;
};

/**
 * Opens a show or collection from a page in the Recordings tab: when that place's page is the
 * one right under this page (a recording opened from it), it goes back there instead of
 * stacking the same page twice.
 */
export const useOpenPlace = () => {
  const router = useRouter();
  const navigation = useNavigation();
  return useCallback(
    (key: string) => {
      const state = navigation.getState();
      const below =
        state === undefined || state.index === 0 ? undefined : state.routes[state.index - 1];
      const params = below?.params;
      const belowKey = params !== undefined && "key" in params ? params.key : undefined;
      if (below?.name === "group/[key]" && belowKey === key) router.back();
      else router.push(groupHref(key));
    },
    [navigation, router],
  );
};

/**
 * The rail's item for the screen's own tab, pressed on a page inside that tab (a recording, a
 * show, Scheduled): back to the tab's first screen, as Google TV does. On the first screen
 * itself it does nothing.
 */
export const useToTabRoot = () => {
  const navigation = useNavigation();
  return useCallback(() => {
    const state = navigation.getState();
    // Only a tab's own stack: the root stack (Search, the player) is not a tab to reset.
    if (state?.type !== "stack" || navigation.getParent()?.getState()?.type !== "tab") return;
    if (state.index > 0) navigation.dispatch({ type: "POP_TO_TOP" });
    else if (state.routes[0]?.name !== "index") {
      navigation.dispatch({ type: "REPLACE", payload: { name: "index" } });
    }
  }, [navigation]);
};
