"use client";

/**
 * Re-export shim. The definition moved to `@lastest/ui` so
 * `@lastest/plugin-app-map`'s Explore dialog can use it — plugins may not
 * import `@/…`. App code keeps importing this path unchanged.
 */
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "@lastest/ui";
