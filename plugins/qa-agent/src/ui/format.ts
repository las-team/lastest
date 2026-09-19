/**
 * Kept as a re-export, not a copy.
 *
 * This file used to hold a verbatim duplicate of the app's `timeAgo` and said
 * "fold it into a shared formatting lib the day a second plugin copies it".
 * `plugins/veeva-migration` copied it, so it moved to `@lastest/ui` (see
 * `libs/ui/src/format.ts`). The file stays so this plugin's own imports did not
 * all have to change in someone else's migration.
 */
export { timeAgo } from "@lastest/ui";
