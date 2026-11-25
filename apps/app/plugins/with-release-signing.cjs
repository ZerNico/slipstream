/**
 * Expo config plugin: the release build's version and signing key.
 *
 * Version. `APP_VERSION` at prebuild (e.g. `0.1.0` or `0.2.0-rc.1`; the release workflow passes the
 * tag's) becomes versionName; without it app.json's `version` is used. versionCode is derived
 * from it, so every release installs over the one before:
 *
 *   major * 1_000_000 + minor * 10_000 + patch * 100 + build
 *
 * where build is 99 for a final release and the prerelease's number (capped at 98) otherwise:
 * 0.1.0 is 10099, 0.2.0-rc.1 is 20001, 0.2.0 is 20099. Minor and patch stay below 100.
 *
 * Signing. The generated app/build.gradle gets a `release` signingConfig read from the
 * environment when Gradle runs: `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD` and
 * `ANDROID_KEY_ALIAS` (the key's password is the store's). Passwords never land in a generated
 * file. Without the variables, release builds stay signed with the debug key as Expo makes them,
 * so local builds work unchanged; with only some of them, Gradle stops with an error.
 */
const { withAppBuildGradle } = require("expo/config-plugins");

const MARKER = "// slipstream: release signing";

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u;

/** The Android versionCode for a semver version; throws for anything else. */
const versionCode = (version) => {
  const match = VERSION.exec(version);
  if (match === null) throw new Error(`with-release-signing: "${version}" is not x.y.z[-pre.N]`);
  const [, major, minor, patch, pre] = match;
  if (Number(minor) > 99 || Number(patch) > 99) {
    throw new Error(`with-release-signing: minor and patch must stay below 100 in "${version}"`);
  }
  const preNumber = pre === undefined ? 99 : Math.min(Number(/(\d+)$/u.exec(pre)?.[1] ?? 0), 98);
  return Number(major) * 1_000_000 + Number(minor) * 10_000 + Number(patch) * 100 + preNumber;
};

const GROOVY_CHECK = `${MARKER} (plugins/with-release-signing.cjs)
def releaseKeystore = System.getenv('ANDROID_KEYSTORE_PATH') ?: null
if (releaseKeystore && !(System.getenv('ANDROID_KEYSTORE_PASSWORD') && System.getenv('ANDROID_KEY_ALIAS'))) {
    throw new GradleException('ANDROID_KEYSTORE_PATH needs ANDROID_KEYSTORE_PASSWORD and ANDROID_KEY_ALIAS')
}

`;

const GROOVY_CONFIG = `
        if (releaseKeystore) {
            release {
                storeFile file(releaseKeystore)
                storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')
                keyAlias System.getenv('ANDROID_KEY_ALIAS')
                keyPassword System.getenv('ANDROID_KEYSTORE_PASSWORD')
            }
        }`;

/** Adds the env-driven release signingConfig to app/build.gradle; once only. */
const addReleaseSigning = (gradle) => {
  if (gradle.includes(MARKER)) return gradle;
  const android = gradle.indexOf("\nandroid {");
  if (android === -1) throw new Error("with-release-signing: build.gradle has no android block");
  let result = `${gradle.slice(0, android + 1)}${GROOVY_CHECK}${gradle.slice(android + 1)}`;
  const configs = result.indexOf("signingConfigs {");
  if (configs === -1) throw new Error("with-release-signing: build.gradle has no signingConfigs");
  const configsEnd = configs + "signingConfigs {".length;
  result = `${result.slice(0, configsEnd)}${GROOVY_CONFIG}${result.slice(configsEnd)}`;
  const release = /(release \{[^}]*?)signingConfig signingConfigs\.debug/u;
  if (!release.test(result)) {
    throw new Error("with-release-signing: the release build type does not sign with debug");
  }
  return result.replace(
    release,
    "$1signingConfig releaseKeystore ? signingConfigs.release : signingConfigs.debug",
  );
};

const withReleaseSigning = (config) => {
  const version = process.env.APP_VERSION || config.version || "0.0.0";
  const versioned = {
    ...config,
    version,
    android: { ...config.android, versionCode: versionCode(version) },
  };
  return withAppBuildGradle(versioned, (mod) => {
    if (mod.modResults.language !== "groovy") {
      throw new Error("with-release-signing: expected a Groovy app/build.gradle");
    }
    mod.modResults.contents = addReleaseSigning(mod.modResults.contents);
    return mod;
  });
};

module.exports = withReleaseSigning;
module.exports.versionCode = versionCode;
module.exports.addReleaseSigning = addReleaseSigning;
