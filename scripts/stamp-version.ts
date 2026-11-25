/**
 * Stamps the version an image reports into `apps/server/package.json`, which the server reads for
 * the system page. The Dockerfile runs it with the `APP_VERSION` and `APP_REVISION` build
 * arguments docker.yml passes: a release tag's version (`0.1.0`) is used as it is; anything else
 * (`edge` on main, `pr-12` for a pull request) is appended to the checked-in version with the
 * short commit, e.g. `0.1.0-edge+1a2b3c4`. Without a version the file is left alone.
 *
 *   node scripts/stamp-version.ts <version> [revision]
 */
import { readFileSync, writeFileSync } from "node:fs";

const release = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** The version to report for a build of `version` at `revision` on top of `base`. */
export const buildVersion = (base: string, version: string, revision = ""): string => {
  if (version === "") return base;
  if (release.test(version)) return version;
  const label = version.replaceAll(/[^0-9A-Za-z.-]/g, "-");
  const commit = revision.slice(0, 7);
  return `${base.split(/[-+]/)[0]}-${label}${commit === "" ? "" : `+${commit}`}`;
};

const main = (): void => {
  const [version = "", revision = ""] = process.argv.slice(2);
  const path = new URL("../apps/server/package.json", import.meta.url);
  const pkg = JSON.parse(readFileSync(path, "utf8")) as { version: string };
  const stamped = buildVersion(pkg.version, version, revision);
  writeFileSync(path, `${JSON.stringify({ ...pkg, version: stamped }, undefined, 2)}\n`);
  console.log(`Server version: ${stamped}`);
};

if (import.meta.main) main();
