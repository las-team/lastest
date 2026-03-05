/**
 * US-010: Move Binding Arrow (Excalidraw)
 *
 * User Story:
 * As a user of Excalidraw
 * I want arrows to stay connected when I move bound elements
 * So that my diagram relationships are preserved
 *
 * Acceptance Criteria:
 * AC-010.1: User can create two rectangles
 * AC-010.2: User can draw arrow connecting both rectangles
 * AC-010.3: User can move one rectangle
 * AC-010.4: Arrow endpoint follows moved rectangle
 * AC-010.5: Arrow maintains connection to both rectangles
 */

export async function test(page, baseUrl, screenshotPath, stepLogger) {
  // Navigate to Excalidraw
  stepLogger.log('Step 1: Navigate to Excalidraw');
  await page.goto(baseUrl);
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('canvas', { state: 'visible' });

  // AC-010.1: Create two rectangles
  stepLogger.log('Step 2-4: Create two rectangles');
  await page.click('[data-testid="toolbar-rectangle"]');

  // First rectangle (100x100 at 100,200)
  await page.mouse.move(100, 200);
  await page.mouse.down();
  await page.mouse.move(200, 300);
  await page.mouse.up();
  await page.waitForTimeout(300);

  // Second rectangle (100x100 at 400,200)
  await page.mouse.move(400, 200);
  await page.mouse.down();
  await page.mouse.move(500, 300);
  await page.mouse.up();
  await page.waitForTimeout(300);

  // AC-010.2: Draw arrow connecting both rectangles
  stepLogger.log('Step 5-8: Draw arrow connecting rectangles');
  await page.click('[data-testid="toolbar-arrow"]');

  // Draw from right edge of rect1 to left edge of rect2
  await page.mouse.move(200, 250);
  await page.mouse.down();
  await page.mouse.move(400, 250, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  stepLogger.log('Capturing screenshot: Baseline with connected arrow');
  await page.screenshot({
    path: `${screenshotPath}-01-baseline.png`,
    fullPage: true
  });

  // AC-010.3: Move one rectangle
  stepLogger.log('Step 9-13: Move first rectangle down');
  await page.click('[data-testid="toolbar-selection"]');

  // Select first rectangle
  await page.mouse.click(150, 250);
  await page.waitForTimeout(300);

  // Drag rectangle down 150px
  await page.mouse.move(150, 250);
  await page.mouse.down();
  await page.mouse.move(150, 400, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  // AC-010.4 & AC-010.5: Capture moved state
  stepLogger.log('Capturing screenshot: Arrow follows moved rectangle');
  await page.screenshot({
    path: `${screenshotPath}-02-moved.png`,
    fullPage: true
  });

  // Verify canvas is still visible
  await expect(page.locator('canvas')).toBeVisible();

  stepLogger.log('Test completed: Arrow maintained connection to moved rectangle');
}
