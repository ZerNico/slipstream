/**
 * Expo config plugin: lets JavaScript hear remote keys going down on Android TV.
 *
 * react-native-tvos 0.88 sends Android TV keys to `useTVEventHandler` only when they come back
 * up, unless `ReactFeatureFlags.enableKeyDownEvents` is on (ReactAndroidHWInputDeviceHelper).
 * The TV guide, the record sheet's and the series editor's steppers act on a key going down
 * (at once, as the remote is pressed), so without this the arrows did nothing there. The player
 * reads both and counts a lone `up` as a press, so it works either way.
 */
const { withMainApplication } = require("expo/config-plugins");

const MARKER = "// slipstream: remote keys going down reach JavaScript";
const LINE = `    ${MARKER}\n    com.facebook.react.config.ReactFeatureFlags.enableKeyDownEvents = true\n`;

/** Inserts the switch right after `super.onCreate()` in MainApplication.onCreate. */
const addSwitch = (contents) => {
  if (contents.includes(MARKER)) return contents;
  const call = "super.onCreate()";
  const at = contents.indexOf(call);
  if (at === -1) throw new Error("with-key-down-events: MainApplication has no super.onCreate()");
  const lineEnd = contents.indexOf("\n", at) + 1;
  return `${contents.slice(0, lineEnd)}${LINE}${contents.slice(lineEnd)}`;
};

module.exports = (config) =>
  withMainApplication(config, (mod) => {
    if (mod.modResults.language !== "kt") {
      throw new Error("with-key-down-events: expected a Kotlin MainApplication");
    }
    mod.modResults.contents = addSwitch(mod.modResults.contents);
    return mod;
  });
