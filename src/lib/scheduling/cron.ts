/**
 * Re-export shim. The implementation moved to `libs/cron` so plugins can use it
 * without a cross-plugin import — `@/lib/scheduling` is the `scheduling`
 * pseudo-plugin, and cron parsing is shared pure logic, which
 * `docs/architecture/core-scope.md` §3 says is a library, not core.
 */
export {
  PRESET_SCHEDULES,
  describeCron,
  getNextRunTime,
  isValidCron,
  type PresetScheduleKey,
} from "@lastest/cron";
