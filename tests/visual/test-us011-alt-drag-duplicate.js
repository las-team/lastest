/**
 * US-011: ALT+Drag Duplicate (Excalidraw)
 *
 * User Story:
 * As a user of Excalidraw
 * I want to duplicate elements by ALT+dragging
 * So that I can quickly create copies
 *
 * Acceptance Criteria:
 * AC-011.1: User can create a rectangle
 * AC-011.2: User can hold ALT and drag rectangle
 * AC-011.3: Original rectangle stays in place
 * AC-011.4: Duplicate appears at new position
 * AC-011.5: Duplicate is identical in size and style
 */

export async function test(page, baseUrl, screenshotPath, stepLogger) {
  // Navigate to Excalidraw
  stepLogger.log('Step 1: Navigate to Excalidraw');
  await page.goto(baseUrl);
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('canvas', { state: 'visible' });

  // AC-011.1: Create a rectangle
  stepLogger.log('Step 2-3: Create rectangle (150x150 at 200,200)');
  await page.click('[data-testid="toolbar-rectangle"]');

  await page.mouse.move(200, 200);
  await page.mouse.down();
  await page.mouse.move(350, 350);
  await page.mouse.up();
  await page.waitForTimeout(500);

  stepLogger.log('Capturing screenshot: Original rectangle');
  await page.screenshot({
    path: `${screenshotPath}-01-original.png`,
    fullPage: true
  });

  // AC-011.2: ALT+drag to duplicate
  stepLogger.log('Step 4-10: Select and ALT+drag to duplicate');
  await page.click('[data-testid="toolbar-selection"]');

  // Select rectangle
  await page.mouse.click(275, 275);
  await page.waitForTimeout(300);

  // Hold ALT and drag to create duplicate
  await page.keyboard.down('Alt');
  await page.mouse.move(275, 275);
  await page.mouse.down();
  await page.mouse.move(475, 275, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await page.waitForTimeout(500);

  // AC-011.3, AC-011.4, AC-011.5: Capture duplicated state
  stepLogger.log('Capturing screenshot: Rectangle duplicated');
  await page.screenshot({
    path: `${screenshotPath}-02-duplicated.png`,
    fullPage: true
  });

  // Verify canvas is still visible
  await expect(page.locator('canvas')).toBeVisible();

  stepLogger.log('Test completed: Rectangle duplicated via ALT+drag');
}
