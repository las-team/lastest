/**
 * Re-export shim. The primitive moved to `libs/ui` so plugin packages can use
 * it without importing app code (`docs/architecture/core-scope.md` §3). App
 * callers keep the `@/components/ui/…` specifier.
 */
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@lastest/ui";
