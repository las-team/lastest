export async function test(page, baseUrl, screenshotPath, stepLogger) {
  stepLogger.log('Navigating to login page');
  await page.goto(`${baseUrl}/login`);

  await page.waitForLoadState('domcontentloaded');

  stepLogger.log('Entering email address');
  await page.locator('#email').fill('testuser1771664821751@example.com');

  stepLogger.log('Entering password');
  await page.locator('#password').fill('SecurePass123');

  stepLogger.log('Taking screenshot of filled login form');
  await page.screenshot({ path: screenshotPath, fullPage: true });

  stepLogger.log('Submitting login form');
  await page.locator('button[type="submit"]').click();

  await page.waitForLoadState('domcontentloaded');

  stepLogger.log('Login completed successfully');
}
