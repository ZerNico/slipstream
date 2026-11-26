import { Platform } from "react-native";
// React Native's sound helper, reached by path: it is not in the public exports.
import SoundManager from "react-native/Libraries/Components/Sound/SoundManager";

/*
 * On Android TV a press clicked twice: the system's click for OK on the focused view, and
 * Pressability's touch sound on top. TV keeps the system one; phones keep theirs.
 */
if (Platform.isTV) {
  SoundManager.playTouchSound = () => undefined;
}
