"use client";

import dynamic from "next/dynamic";

const TooltipTrigger = dynamic(
  () => import("./tooltip.client").then((mod) => mod.TooltipTrigger),
  {
    ssr: false,
  },
);

const Tooltip = dynamic(
  () => import("./tooltip.client").then((mod) => mod.Tooltip),
  {
    ssr: false,
  },
);

const TooltipContent = dynamic(
  () => import("./tooltip.client").then((mod) => mod.TooltipContent),
  {
    ssr: false,
  },
);

const TooltipProvider = dynamic(
  () => import("./tooltip.client").then((mod) => mod.TooltipProvider),
  {
    ssr: false,
  },
);

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
