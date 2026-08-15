/**
 * Re-export shim. The primitive moved to `libs/ui` so plugin packages can use
 * it without importing app code (`docs/architecture/core-scope.md` §3). App
 * callers keep the `@/components/ui/…` specifier.
 */
export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@lastest/ui";
