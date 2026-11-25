import { Platform } from "react-native";
import { PasswordScreen } from "../src/signin/PasswordScreen.tsx";
import { SignInScreen } from "../src/signin/SignInScreen.tsx";

/**
 * Signing in: a TV shows a QR code a phone approves; a phone signs in with username and
 * password itself (a QR code to scan with the phone in your hand makes no sense).
 */
export default function SignInRoute() {
  return Platform.isTV ? <SignInScreen /> : <PasswordScreen />;
}
