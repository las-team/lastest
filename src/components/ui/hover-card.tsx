"use client";

/**
 * Re-export shim. The definition moved to `@lastest/ui` so
 * `@lastest/plugin-rca`'s verdict badge can use it — plugins may not import
 * `@/…`. App code keeps importing this path unchanged.
 */
export { HoverCard, HoverCardTrigger, HoverCardContent } from "@lastest/ui";
