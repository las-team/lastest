/**
 * `@lastest/ui` — the design-system primitives a plugin's UI needs.
 *
 * A library, not core (`core-scope.md` §3): a button guards no tenancy, meters
 * no spend and holds no credential. It exists because plugins may not import
 * `@/…`, and the alternative — each plugin re-implementing its own button —
 * would fork the design system one feature at a time.
 *
 * Scope is deliberately "what the migrated plugins actually use", not all of
 * `src/components/ui`. The app keeps re-export shims at the old paths so
 * nothing else had to change; each primitive moved here has exactly one
 * definition, and it is this one.
 */
export { Badge, badgeVariants } from "./badge";
export { Button, buttonVariants } from "./button";
export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card";
export { cn } from "./cn";
export { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card";
export { Input } from "./input";
export { Label } from "./label";
export { Progress } from "./progress";
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
} from "./select";
export { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";
export { Textarea } from "./textarea";
