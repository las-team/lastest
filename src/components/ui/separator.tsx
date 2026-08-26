"use client";

/**
 * Re-export shim. The definition moved to `@lastest/ui` so
 * `@lastest/plugin-api-test`'s request form can use it — plugins may not
 * import `@/…`. App code keeps importing this path unchanged.
 */
export { Separator } from "@lastest/ui";
