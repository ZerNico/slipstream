import type { GroupSection as Section, LibraryGroup as Group } from "@slipstream/domain";
import type { Entry } from "./library.ts";

// The library's groups live in the domain (web and phone); here they hold the API's entries.
export { groupKeyOf, groupPage, libraryGroups, slug } from "@slipstream/domain";

/** A place in the library holding the API's recordings. */
export type LibraryGroup = Group<Entry>;
/** One section of a group page. */
export type GroupSection = Section<Entry>;
