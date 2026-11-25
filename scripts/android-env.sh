# Source this before Android builds: `source scripts/android-env.sh`. The node scripts (pnpm doctor,
# the app's tv and dev-client) set the same paths themselves: androidEnv in apps/app/scripts/android.ts.
export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
