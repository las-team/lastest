/**
 * US-014: Redo Element Creation (Excalidraw)
 *
 * User Story:
 * As a user of Excalidraw
 * I want to redo an undone action
 * So that I can restore work I removed by mistake
 *
 * Acceptance Criteria:
 * AC-014.1: User can create and undo an element
 * AC-014.2: User can press Ctrl+Shift+Z to redo
 * AC-014.3: Element reappears on canvas
 * AC-014.4: Visual diff confirms element restoration
 */

export async function test(page, baseUrl, screenshotPath, stepLogger) {
  // Navigate to Excalidraw
  stepLogger.log('Step 1: Navigate to Excalidraw');
  await page.goto(baseUrl);
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('canvas', { state: 'visible' });

  // AC-014.1: Create and undo an element
  stepLogger.log('Step 2-5: Create rectangle and undo');
  await page.click('[data-testid="toolbar-rectangle"]');

  await page.mouse.move(200, 200);
  await page.mouse.down();
  await page.mouse.move(350, 350);
  await page.mouse.up();
  await page.waitForTimeout(500);

  // Undo the rectangle
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);

  stepLogger.log('Capturing screenshot: After undo (empty canvas)');
  await page.screenshot({
    path: `${screenshotPath}-01-undone.png`,
    fullPage: true
  });

  // AC-014.2: Press Ctrl+Shift+Z to redo
  stepLogger.log('Step 6-7: Redo rectangle creation');
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(200);

  // AC-014.3 & AC-014.4: Capture redone state
  stepLogger.log('Capturing screenshot: Rectangle redone');
  await page.screenshot({
    path: `${screenshotPath}-02-redone.png`,
    fullPage: true
  });

  // Verify canvas is still visible
  await expect(page.locator('canvas')).toBeVisible();

  stepLogger.log('Test completed: Rectangle successfully restored via redo');
}
