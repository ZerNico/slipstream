/**
 * Identifier generation. Every entity id is a random UUID (v4), opaque to clients.
 */
import { randomUUID } from "node:crypto";

/** A new random identifier. */
export const newId = (): string => randomUUID();
