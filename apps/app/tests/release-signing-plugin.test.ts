import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

interface Plugin {
  readonly versionCode: (version: string) => number;
  readonly addReleaseSigning: (gradle: string) => string;
}

const plugin = createRequire(import.meta.url)("../plugins/with-release-signing.cjs") as Plugin;

/** The parts of the app/build.gradle prebuild generates that the plugin edits. */
const gradle = `apply plugin: "com.android.application"

android {
    defaultConfig {
        versionCode 1
        versionName "0.0.0"
    }
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}
`;

describe("versionCode", () => {
  it("orders releases and their prereleases", () => {
    expect(plugin.versionCode("0.1.0")).toBe(10_099);
    expect(plugin.versionCode("0.2.0-rc.1")).toBe(20_001);
    expect(plugin.versionCode("0.2.0")).toBe(20_099);
    expect(plugin.versionCode("1.12.3")).toBe(1_120_399);
    expect(plugin.versionCode("0.2.0-beta")).toBeLessThan(plugin.versionCode("0.2.0-rc.1"));
  });

  it("refuses versions it cannot order", () => {
    expect(() => plugin.versionCode("1.2")).toThrow("is not x.y.z");
    expect(() => plugin.versionCode("1.100.0")).toThrow("below 100");
  });

  it("accepts the version in app.json", () => {
    const app = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8")) as {
      expo: { version: string; plugins: unknown[] };
    };
    expect(plugin.versionCode(app.expo.version)).toBeGreaterThan(0);
    expect(app.expo.plugins).toContain("./plugins/with-release-signing.cjs");
  });
});

describe("addReleaseSigning", () => {
  it("signs release builds with the key from the environment, else the debug key", () => {
    const result = plugin.addReleaseSigning(gradle);
    expect(result).toContain("def releaseKeystore = System.getenv('ANDROID_KEYSTORE_PATH')");
    expect(result).toMatch(/signingConfigs \{\n {8}if \(releaseKeystore\) \{\n {12}release \{/u);
    expect(result).toContain(
      "signingConfig releaseKeystore ? signingConfigs.release : signingConfigs.debug",
    );
    // The debug build type keeps the debug key.
    expect(result).toMatch(/debug \{\n {12}signingConfig signingConfigs\.debug\n/u);
    expect(result).not.toMatch(/Password '(?!android)/u);
  });

  it("changes a gradle file it already changed no further", () => {
    const once = plugin.addReleaseSigning(gradle);
    expect(plugin.addReleaseSigning(once)).toBe(once);
  });

  it("fails loudly when the generated file looks different", () => {
    expect(() => plugin.addReleaseSigning("android {\n}\n")).toThrow("no android block");
  });
});
