import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log('Navigating to login page...');
    await page.goto('http://localhost:3000/login');
    await page.waitForLoadState('networkidle');

    console.log('\n=== Page Title ===');
    console.log(await page.title());

    console.log('\n=== Email Input ===');
    const emailInput = await page.locator('#email').count();
    console.log(`Found by #email: ${emailInput}`);
    const emailPlaceholder = await page.locator('input[type="email"]').count();
    console.log(`Found by input[type="email"]: ${emailPlaceholder}`);

    console.log('\n=== Password Input ===');
    const passwordInput = await page.locator('#password').count();
    console.log(`Found by #password: ${passwordInput}`);
    const passwordType = await page.locator('input[type="password"]').count();
    console.log(`Found by input[type="password"]: ${passwordType}`);

    console.log('\n=== Submit Button ===');
    const submitButton = await page.locator('button[type="submit"]').count();
    console.log(`Found by button[type="submit"]: ${submitButton}`);
    const signInButton = await page.locator('text=Sign in').count();
    console.log(`Found by text=Sign in: ${signInButton}`);

    console.log('\n=== Testing Login Flow ===');
    await page.fill('#email', 'test-user-1770561637190@example.com');
    await page.fill('#password', 'TestPassword123!');

    console.log('Filled credentials');
    console.log('Email value:', await page.locator('#email').inputValue());
    console.log('Password filled:', (await page.locator('#password').inputValue()).length > 0);

    console.log('\n=== Success! All selectors found ===');

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
})();
