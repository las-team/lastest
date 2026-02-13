/**
 * Playwright Setup Script for Cursor Insight CMS
 * Handles user authentication flow
 */

export async function setup(page, baseUrl, screenshotPath, stepLogger) {
  try {
    stepLogger.log('Starting login process...');

    // Navigate to the login page
    // Common login paths: /login, /auth/login, /signin, /auth/signin
    stepLogger.log('Navigating to login page...');
    await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });

    // Wait for login form to be visible
    stepLogger.log('Waiting for login form...');
    await page.waitForSelector('input[type="email"], input[type="text"][name*="email"], input[name="email"]', {
      timeout: 10000
    });

    // Fill in email
    stepLogger.log('Entering email credentials...');
    const emailSelector = 'input[type="email"], input[type="text"][name*="email"], input[name="email"]';
    await page.fill(emailSelector, 'test@example.com');

    // Fill in password
    stepLogger.log('Entering password...');
    const passwordSelector = 'input[type="password"], input[name="password"]';
    await page.fill(passwordSelector, 'Password123!');

    // Submit the form
    stepLogger.log('Submitting login form...');
    const submitButton = page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in"), input[type="submit"]').first();
    await submitButton.click();

    // Wait for navigation or successful login indicator
    stepLogger.log('Waiting for authentication...');

    // Wait for either:
    // 1. URL change (redirect to dashboard)
    // 2. Disappearance of login form
    // 3. Appearance of authenticated content
    await Promise.race([
      page.waitForURL(url => !url.includes('/login'), { timeout: 15000 }),
      page.waitForSelector('nav, [data-testid="dashboard"], .dashboard, main', { timeout: 15000 }),
      page.waitForLoadState('networkidle', { timeout: 15000 })
    ]);

    // Verify login success by checking for logout button or user menu
    stepLogger.log('Verifying login success...');
    const isLoggedIn = await page.locator('button:has-text("Logout"), button:has-text("Sign out"), [data-testid="user-menu"], .user-menu').first().isVisible({ timeout: 5000 }).catch(() => false);

    if (!isLoggedIn) {
      // Alternative check: verify we're not on login page anymore
      const currentUrl = page.url();
      if (currentUrl.includes('/login')) {
        throw new Error('Login failed - still on login page');
      }
    }

    stepLogger.log('Login successful!');

    return {
      loggedIn: true,
      userEmail: 'test@example.com'
    };

  } catch (error) {
    stepLogger.log(`Login failed: ${error.message}`);
    throw error;
  }
}
