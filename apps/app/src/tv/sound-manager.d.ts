// The one member of React Native's internal SoundManager the TV build silences.
declare module "react-native/Libraries/Components/Sound/SoundManager" {
  const SoundManager: { playTouchSound: () => void };
  export default SoundManager;
}
