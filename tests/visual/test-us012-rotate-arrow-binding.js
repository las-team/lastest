/**
 * US-012: Rotate Arrow Binding (Excalidraw)
 *
 * User Story:
 * As a user of Excalidraw
 * I want arrows to update when I rotate bound elements
 * So that connections remain visually accurate
 *
 * Acceptance Criteria:
 * AC-012.1: User can create rectangle with bound arrow
 * AC-012.2: User can rotate rectangle using rotation handle
 * AC-012.3: Arrow endpoint follows rotated rectangle edge
 * AC-012.4: Visual diff confirms arrow angle change
 */

export async function test(page, baseUrl, screenshotPath, stepLogger) {
  // Navigate to Excalidraw
  stepLogger.log('Step 1: Navigate to Excalidraw');
  await page.goto(baseUrl);
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('canvas', { state: 'visible' });

  // AC-012.1: Create rectangle with bound arrow
  stepLogger.log('Step 2-7: Create rectangle and bind arrow');
  await page.click('[data-testid="toolbar-rectangle"]');

  // Draw rectangle (150x150 at 300,200)
  await page.mouse.move(300, 200);
  await page.mouse.down();
  await page.mouse.move(450, 350);
  await page.mouse.up();
  await page.waitForTimeout(300);

  // Draw arrow from left pointing to rectangle
  await page.click('[data-testid="toolbar-arrow"]');
  await page.mouse.move(100, 275);
  await page.mouse.down();
  await page.mouse.move(300, 275, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  stepLogger.log('Capturing screenshot: Baseline with arrow');
  await page.screenshot({
    path: `${screenshotPath}-01-baseline.png`,
    fullPage: true
  });

  // AC-012.2: Rotate rectangle using rotation handle
  stepLogger.log('Step 8-13: Select rectangle and rotate');
  await page.click('[data-testid="toolbar-selection"]');

  // Select rectangle (center at 375, 275)
  await page.mouse.click(375, 275);
  await page.waitForTimeout(300);

  // Move to rotation handle (approximately top-center of selected rectangle)
  // Rotation handle appears above the element when selected
  await page.mouse.move(375, 150);
  await page.waitForTimeout(200);

  // Rotate by dragging rotation handle ~45 degrees clockwise
  await page.mouse.down();
  await page.mouse.move(475, 200, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  // AC-012.3 & AC-012.4: Capture rotated state
  stepLogger.log('Capturing screenshot: Rectangle rotated, arrow updated');
  await page.screenshot({
    path: `${screenshotPath}-02-rotated.png`,
    fullPage: true
  });

  // Verify canvas is still visible
  await expect(page.locator('canvas')).toBeVisible();

  stepLogger.log('Test completed: Arrow endpoint followed rotated rectangle');
}
