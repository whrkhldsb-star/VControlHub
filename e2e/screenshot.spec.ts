import { test } from '@playwright/test';
test('screenshot login', async ({ page }) => {
  await page.goto('/login');
  await page.screenshot({ path: '.playwright-output/login-dark.png' });
  
  // Set theme cookie to light
  const origin = new URL(page.url()).origin;
  await page.context().addCookies([{ name: 'vps-theme', value: 'light', url: origin }]);
  await page.goto('/login');
  await page.screenshot({ path: '.playwright-output/login-light.png' });
});
