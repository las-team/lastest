/**
 * Size caps on a plugin-authored test.
 *
 * No existing precedent in the app to inherit — these are new, chosen to be
 * generous for a machine-authored Playwright flow while keeping one plugin
 * from writing an unbounded blob into a core table it cannot otherwise touch.
 * Character counts (UTF-16 code units), not bytes: exactness is not the
 * point, a sane ceiling is.
 */
export const MAX_TEST_NAME_LENGTH = 200;
export const MAX_AREA_NAME_LENGTH = 100;
export const MAX_TEST_CODE_LENGTH = 200_000;
export const MAX_TARGET_URL_LENGTH = 2048;
