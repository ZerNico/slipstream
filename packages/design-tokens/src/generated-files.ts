/** Where the generated files live, shared by the generator and the freshness test. */
export const generatedFiles = {
  tailwind: new URL("generated/tailwind.css", import.meta.url),
  native: new URL("generated/native.ts", import.meta.url),
} as const;
