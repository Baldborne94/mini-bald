import { expect, test } from '../fixtures';

// Runs last (its own project): while a PIN is set every other request would be refused.
test.use({ allowedErrors: [[/status of 40[13]/, /status of 429/], { scope: 'test' }] });
test.describe.configure({ mode: 'serial' });

test('set a PIN, lock, unlock, other devices are kept out, change and remove it', async ({ page, browser, answers }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Set a PIN' }).click();
  await page.getByLabel('New PIN (at least 4 characters)').fill('2468');
  await page.getByLabel('Repeat it').fill('2467');
  await expect(page.getByText('The two PINs do not match.')).toBeVisible();
  await page.getByLabel('Repeat it').fill('2468');
  await page.getByRole('button', { name: 'Save PIN' }).click();
  await expect(page.getByText(/PIN set/)).toBeVisible();

  // A second device is locked out, photos included.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto('/minis');
  await expect(otherPage.getByLabel('PIN')).toBeVisible();
  expect((await otherPage.request.get('/api/miniatures')).status()).toBe(401);
  expect((await otherPage.request.get('/api/media/photos/1')).status()).toBe(401);
  expect((await otherPage.request.get('/api/backup/database')).status()).toBe(401);
  await other.close();

  await page.getByRole('button', { name: 'Lock this device now' }).click();
  await expect(page.getByLabel('PIN')).toBeVisible();
  await page.getByLabel('PIN').fill('0000');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('alert')).toHaveText('Wrong PIN.');
  await page.getByLabel('PIN').fill('2468');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();

  await page.getByRole('button', { name: 'Change PIN' }).click();
  await page.getByLabel('Current PIN').fill('2468');
  await page.getByLabel('New PIN (at least 4 characters)').fill('1357');
  await page.getByLabel('Repeat it').fill('1357');
  await page.getByRole('button', { name: 'Save PIN' }).click();
  await expect(page.getByText(/PIN changed/)).toBeVisible();

  answers.push('1357');
  await page.getByRole('button', { name: 'Remove PIN' }).click();
  await expect(page.getByText('PIN removed.')).toBeVisible();
  expect(await (await page.request.get('/api/auth/status')).json()).toEqual({ pinEnabled: false, unlocked: true });
});

test.afterAll(async ({ request }) => {
  // Safety net if the test stopped half-way: make sure no PIN is left behind.
  const status = await (await request.get('/api/auth/status')).json();
  if (status.pinEnabled) console.warn('A PIN is still set on the e2e server (it is discarded when the run ends).');
});
