/**
 * Copies text to the clipboard. Answers false where the browser refuses (no permission, an
 * insecure origin), so the caller can say so instead of claiming it worked.
 */
export const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};
