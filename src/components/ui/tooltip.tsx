"use client"

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { cn } from "@/lib/utils"
import { TooltipProvider } from "@lastest/shared/components/tooltip-provider"

function getTextFromReactChildren(node: React.ReactNode): string {
  if (node == null || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(getTextFromReactChildren).join(' ').trim()
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return getTextFromReactChildren(node.props.children)
  }
  return ''
}

function Tooltip({
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  // Auto-forward TooltipContent's text to the trigger's child as `aria-label`.
  // axe-core flags icon-only buttons wrapped in tooltips because the tooltip
  // text is only revealed on hover — screen readers can't see it. By cloning
  // the TooltipTrigger and propagating the label through `data-tooltip-label`,
  // the TooltipTrigger renderer applies it as `aria-label` on the underlying
  // button. Explicit `aria-label` / `aria-labelledby` on the trigger child wins.
  let label = ''
  React.Children.forEach(children, (child) => {
    if (label) return
    if (React.isValidElement(child) && child.type === TooltipContent) {
      label = getTextFromReactChildren(
        (child.props as { children?: React.ReactNode }).children,
      ).trim()
    }
  })

  const enriched = label
    ? React.Children.map(children, (child) => {
        if (
          React.isValidElement<{ 'data-tooltip-label'?: string }>(child) &&
          child.type === TooltipTrigger
        ) {
          return React.cloneElement(child, { 'data-tooltip-label': label })
        }
        return child
      })
    : children

  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props}>
        {enriched}
      </TooltipPrimitive.Root>
    </TooltipProvider>
  )
}

function TooltipTrigger({
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger> & {
  'data-tooltip-label'?: string
}) {
  const { 'data-tooltip-label': tooltipLabel, ...rest } = props
  // If the trigger renders an `asChild` element (typical for icon Buttons), and
  // that element has no accessible name, inject `aria-label` from the tooltip
  // text we got from <Tooltip>. Explicit caller props always win.
  const child = React.isValidElement<{
    'aria-label'?: string
    'aria-labelledby'?: string
    children?: React.ReactNode
  }>(children)
    ? children
    : null

  let enrichedChild: React.ReactNode = children
  if (tooltipLabel && child) {
    const hasOwnLabel =
      child.props['aria-label'] || child.props['aria-labelledby']
    const childHasVisibleText =
      getTextFromReactChildren(child.props.children).trim().length > 0
    if (!hasOwnLabel && !childHasVisibleText) {
      enrichedChild = React.cloneElement(child, { 'aria-label': tooltipLabel })
    }
  }

  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      // When not using asChild, fall back to setting aria-label directly on the trigger.
      aria-label={
        tooltipLabel && !rest.asChild ? (rest['aria-label'] ?? tooltipLabel) : rest['aria-label']
      }
      {...rest}
    >
      {enrichedChild}
    </TooltipPrimitive.Trigger>
  )
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "bg-foreground text-background animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance",
          className
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="bg-foreground fill-foreground z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
