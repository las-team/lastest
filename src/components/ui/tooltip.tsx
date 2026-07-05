// Direct re-export of the SSR-able client module. This file previously wrapped
// all four exports in next/dynamic({ ssr: false }); because the root layout's
// <TooltipProvider> wraps {children}, that bailed the ENTIRE body of every page
// out of server rendering ("BAILOUT_TO_CLIENT_SIDE_RENDERING") — crawlers got an
// empty shell, which is why /r/ shares were never classified as video watch
// pages (no <video>, no JSON-LD in the served HTML). Radix's tooltip primitives
// are SSR-safe ("use client" modules render fine on the server), so the dynamic
// wrapper bought nothing and cost all server HTML. Do not reintroduce ssr:false
// here.
export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "./tooltip.client";
