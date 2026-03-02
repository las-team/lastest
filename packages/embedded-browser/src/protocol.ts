/**
 * Protocol types for the embedded browser package.
 * StabilizationPayload is now a type alias for the shared CoreStabilizationSettings.
 */

import type { CoreStabilizationSettings } from '@lastest/shared';

export type StabilizationPayload = CoreStabilizationSettings;
