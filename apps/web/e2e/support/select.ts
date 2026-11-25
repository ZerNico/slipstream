import type { Locator, Page } from "@playwright/test";

/*
 * The app's select (Base UI): a `combobox` button showing the picked label; its options are a
 * `listbox` that exists only while open.
 */

/** What the select shows, with every run of spaces as one. */
export const selectText = async (select: Locator): Promise<string> =>
  ((await select.textContent()) ?? "").replaceAll(/\s+/gu, " ").trim();

/** The first number the select shows ("10 min" reads 10). */
export const selectNumber = async (select: Locator): Promise<number> =>
  Number(/\d+/u.exec(await selectText(select))?.[0] ?? Number.NaN);

/** Opens the select and picks the option named `label`. */
export const pick = async (page: Page, select: Locator, label: string | RegExp): Promise<void> => {
  await select.click();
  await page.getByRole("option", { name: label, exact: typeof label === "string" }).click();
};

/** Opens the select, reads its options' labels and closes it again. */
export const optionTexts = async (page: Page, select: Locator): Promise<string[]> => {
  await select.click();
  const listbox = page.getByRole("listbox");
  await listbox.waitFor();
  const texts = (await listbox.getByRole("option").allTextContents()).map((text) =>
    text.replaceAll(/\s+/gu, " ").trim(),
  );
  await page.keyboard.press("Escape");
  return texts;
};
