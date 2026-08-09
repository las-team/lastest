import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * The class-merger every primitive here uses.
 *
 * A copy of the app's `cn`, not an import of it: `@/lib/utils` also exports
 * `getPublicUrl`, which takes a `NextRequest` — pulling that into a library
 * consumed by plugins would make Next's server types a dependency of every
 * button. Two lines duplicated beats that.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
