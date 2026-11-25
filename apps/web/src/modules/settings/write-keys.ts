/** Writes from the profile form, so its dialog's Save knows one is running. */
export const profileWriteKey = ["profiles", "write"] as const;

/** Writes from the invite form, so its dialog's footer knows one is running. */
export const guestWriteKey = ["guests", "write"] as const;
