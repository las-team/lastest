import type { SelectorConfig, SelectorType } from './db/schema';
import type { SelectorTypeStats } from './db/queries';

export type RecommendationType = 'disable' | 'enable' | 'move_up';

export interface SelectorRecommendation {
  type: RecommendationType;
  reason: string;
}

// Thresholds for recommendations
const MIN_ATTEMPTS_FOR_DISABLE = 10;
const FAILURE_RATE_THRESHOLD = 70; // percentage
const LOW_SUCCESS_RATE_THRESHOLD = 30; // percentage
const ENABLE_SUCCESS_RATE_THRESHOLD = 50; // percentage
const MOVE_UP_SUCCESS_RATE_DIFF = 20; // percentage difference

export function calculateRecommendations(
  selectorPriority: SelectorConfig[],
  stats: SelectorTypeStats[]
): Map<SelectorType, SelectorRecommendation> {
  const recommendations = new Map<SelectorType, SelectorRecommendation>();

  // Create stats map for easy lookup
  const statsMap = new Map<string, SelectorTypeStats>();
  for (const stat of stats) {
    statsMap.set(stat.selectorType, stat);
  }

  // Get enabled selectors in priority order
  const enabledSelectors = selectorPriority.filter((s) => s.enabled);
  const disabledSelectors = selectorPriority.filter((s) => !s.enabled);

  // Check for DISABLE recommendations
  for (const selector of enabledSelectors) {
    const stat = statsMap.get(selector.type);
    if (!stat) continue;

    if (stat.totalAttempts >= MIN_ATTEMPTS_FOR_DISABLE) {
      const failureRate = 100 - stat.successRate;
      if (failureRate >= FAILURE_RATE_THRESHOLD) {
        recommendations.set(selector.type, {
          type: 'disable',
          reason: `${failureRate}% failure rate (${stat.totalFailures}/${stat.totalAttempts} attempts)`,
        });
      }
    }
  }

  // Check for ENABLE recommendations
  // Only suggest enabling if all enabled selectors have low success AND the disabled one has good success
  const allEnabledHaveLowSuccess = enabledSelectors.every((s) => {
    const stat = statsMap.get(s.type);
    return !stat || stat.totalAttempts === 0 || stat.successRate < LOW_SUCCESS_RATE_THRESHOLD;
  });

  if (allEnabledHaveLowSuccess && enabledSelectors.some((s) => statsMap.has(s.type))) {
    for (const selector of disabledSelectors) {
      const stat = statsMap.get(selector.type);
      if (!stat || stat.totalAttempts === 0) continue;

      if (stat.successRate > ENABLE_SUCCESS_RATE_THRESHOLD) {
        recommendations.set(selector.type, {
          type: 'enable',
          reason: `${stat.successRate}% success rate could help (all enabled selectors < ${LOW_SUCCESS_RATE_THRESHOLD}%)`,
        });
      }
    }
  }

  // Check for MOVE_UP recommendations
  // Compare each selector with higher-priority ones
  for (let i = 1; i < enabledSelectors.length; i++) {
    const selector = enabledSelectors[i];
    const stat = statsMap.get(selector.type);
    if (!stat || stat.totalAttempts === 0) continue;

    // Skip if already recommended for disable
    if (recommendations.has(selector.type)) continue;

    // Compare with higher priority selectors
    for (let j = 0; j < i; j++) {
      const higherSelector = enabledSelectors[j];
      const higherStat = statsMap.get(higherSelector.type);
      if (!higherStat || higherStat.totalAttempts === 0) continue;

      // Skip if higher one is already recommended for disable
      if (recommendations.get(higherSelector.type)?.type === 'disable') continue;

      const successDiff = stat.successRate - higherStat.successRate;

      // Must have significantly better success rate AND (optionally) faster response time
      if (successDiff >= MOVE_UP_SUCCESS_RATE_DIFF) {
        const hasFasterResponse =
          stat.avgResponseTimeMs != null &&
          higherStat.avgResponseTimeMs != null &&
          stat.avgResponseTimeMs < higherStat.avgResponseTimeMs;

        // Require better success rate; faster response is a bonus but not required
        if (hasFasterResponse || successDiff >= MOVE_UP_SUCCESS_RATE_DIFF) {
          const responsePart = hasFasterResponse
            ? `, ${stat.avgResponseTimeMs}ms vs ${higherStat.avgResponseTimeMs}ms`
            : '';
          recommendations.set(selector.type, {
            type: 'move_up',
            reason: `${stat.successRate}% success vs ${higherStat.successRate}% for ${higherSelector.type}${responsePart}`,
          });
          break; // Only show one move_up recommendation per selector
        }
      }
    }
  }

  return recommendations;
}
