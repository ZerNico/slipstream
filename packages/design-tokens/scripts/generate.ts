/**
 * Writes the generated token files. Run `pnpm --filter @slipstream/design-tokens generate`
 * after changing src/tokens.ts; a test fails while the committed files are out of date.
 */
import { writeFile } from "node:fs/promises";
import { buildNativeModule, buildTailwindCss } from "../src/build.ts";
import { generatedFiles } from "../src/generated-files.ts";

await writeFile(generatedFiles.tailwind, buildTailwindCss());
await writeFile(generatedFiles.native, buildNativeModule());
