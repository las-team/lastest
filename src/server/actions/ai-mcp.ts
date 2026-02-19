'use server';

import {
  extractSelectors,
  validateSelectorsOnPage,
  type SelectorValidationResult,
} from '@/lib/ai/mcp-validator';
import { requireTeamAccess } from '@/lib/auth';

export async function mcpValidateTest(
  code: string,
  pageUrl: string
): Promise<{
  success: boolean;
  valid?: boolean;
  results?: SelectorValidationResult[];
  error?: string;
}> {
  await requireTeamAccess();
  try {
    // Extract selectors from the test code
    const selectors = extractSelectors(code);

    if (selectors.length === 0) {
      return {
        success: true,
        valid: true,
        results: [],
      };
    }

    // Validate selectors against the live page
    const result = await validateSelectorsOnPage(pageUrl, selectors);

    if (result.pageError) {
      return {
        success: false,
        error: result.pageError,
      };
    }

    return {
      success: true,
      valid: result.valid,
      results: result.results,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Validation failed';
    return { success: false, error: message };
  }
}
