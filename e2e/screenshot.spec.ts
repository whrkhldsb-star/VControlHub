import { test } from '@playwright/test';
test('screenshot login', async ({ page }) => {
  await page.goto('http://localhost:3000/login');
  await page.screenshot({ path: 'login-dark.png' });
  
  // Set theme cookie to light
  await page.context().addCookies([{ name: 'vps-theme', value: 'light', url: 'http://localhost:3000' }]);
  await page.goto('http://localhost:3000/login');
  await page.screenshot({ path: 'login-light.png' });
});
