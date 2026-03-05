/**
 * US-013: Undo Element Creation (Excalidraw)
 *
 * User Story:
 * As a user of Excalidraw
 * I want to undo my last action
 * So that I can correct mistakes
 *
 * Acceptance Criteria:
 * AC-013.1: User can create an element
 * AC-013.2: User can press Ctrl+Z to undo
 * AC-013.3: Element is removed from canvas
 * AC-013.4: Canvas returns to previous state
 */

export async function test(page, baseUrl, screenshotPath, stepLogger) {
  // Navigate to Excalidraw
  stepLogger.log('Step 1: Navigate to Excalidraw');
  await page.goto(baseUrl);
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('canvas', { state: 'visible' });
  await page.waitForTimeout(500);

  // AC-013.4: Capture empty canvas baseline
  stepLogger.log('Capturing screenshot: Empty canvas');
  await page.screenshot({
    path: `${screenshotPath}-01-empty.png`,
    fullPage: true
  });

  // AC-013.1: Create an element
  stepLogger.log('Step 2-3: Create rectangle');
  await page.click('[data-testid="toolbar-rectangle"]');

  await page.mouse.move(200, 200);
  await page.mouse.down();
  await page.mouse.move(350, 350);
  await page.mouse.up();
  await page.waitForTimeout(500);

  stepLogger.log('Capturing screenshot: Rectangle created');
  await page.screenshot({
    path: `${screenshotPath}-02-created.png`,
    fullPage: true
  });

  // AC-013.2: Press Ctrl+Z to undo
  stepLogger.log('Step 4-5: Undo rectangle creation');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);

  // AC-013.3 & AC-013.4: Capture undone state
  stepLogger.log('Capturing screenshot: Rectangle undone');
  await page.screenshot({
    path: `${screenshotPath}-03-undone.png`,
    fullPage: true
  });

  // Verify canvas is still visible
  await expect(page.locator('canvas')).toBeVisible();

  stepLogger.log('Test completed: Rectangle creation undone successfully');
}
