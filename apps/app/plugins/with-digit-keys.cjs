/**
 * Expo config plugin: forwards the remote's digit keys (0 to 9) to JavaScript.
 *
 * react-native-tvos 0.88 delivers arrows, OK, media and channel keys through
 * `useTVEventHandler`, but not KEYCODE_0..KEYCODE_9. This plugin overrides
 * `MainActivity.dispatchKeyEvent` to emit a `slipstreamDigit` device event with the digit
 * (see src/tv/digit-keys.ts). The key is only consumed when React Native is running to
 * receive it, so text fields and the system keep working otherwise.
 */
const { withMainActivity } = require("expo/config-plugins");

const MARKER = "// slipstream: digit key forwarder";

const KOTLIN = `
  ${MARKER}
  override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
    val code = event.keyCode
    if (code >= android.view.KeyEvent.KEYCODE_0 && code <= android.view.KeyEvent.KEYCODE_9) {
      val context = (application as com.facebook.react.ReactApplication).reactHost?.currentReactContext
      if (context != null && currentFocus !is android.widget.EditText) {
        if (event.action == android.view.KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
          context
            .getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("slipstreamDigit", code - android.view.KeyEvent.KEYCODE_0)
        }
        return true
      }
    }
    return super.dispatchKeyEvent(event)
  }
`;

/** Inserts the override before the closing brace of the MainActivity class. */
const addForwarder = (contents) => {
  if (contents.includes(MARKER)) return contents;
  const end = contents.lastIndexOf("}");
  if (end === -1) throw new Error("with-digit-keys: MainActivity.kt has no class body");
  return `${contents.slice(0, end)}${KOTLIN}${contents.slice(end)}`;
};

module.exports = (config) =>
  withMainActivity(config, (mod) => {
    if (mod.modResults.language !== "kt") {
      throw new Error("with-digit-keys: expected a Kotlin MainActivity");
    }
    mod.modResults.contents = addForwarder(mod.modResults.contents);
    return mod;
  });
