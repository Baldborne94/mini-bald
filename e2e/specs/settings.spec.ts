import fs from 'node:fs';
import { expect, test } from '../fixtures';

test('the theme applies at once and is remembered on this device @phone', async ({ page }) => {
  await page.goto('/settings');
  for (const [name, id] of [['Forge', 'forge'], ['Wet Palette', 'palette'], ['Pop Primer', 'pop'], ['Night Shift', 'midnight']] as const) {
    await page.getByRole('radio', { name: new RegExp(name) }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', id);
  }
  await page.getByRole('radio', { name: /Forge/ }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'forge');
  await expect(page.getByRole('radio', { name: /Forge/ })).toHaveAttribute('aria-checked', 'true');
});

test('backups and exports download', async ({ page }) => {
  await page.goto('/settings');
  const download = async (name: string) => {
    const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name }).click()]);
    return { name: file.suggestedFilename(), bytes: fs.readFileSync((await file.path())!) };
  };
  const full = await download('Full backup (.zip)');
  expect(full.name).toMatch(/^minibald-backup-\d{4}-\d{2}-\d{2}\.zip$/);
  expect(full.bytes.subarray(0, 2).toString()).toBe('PK');
  const db = await download('Database only');
  expect(db.name).toMatch(/^minibald-\d{4}-\d{2}-\d{2}\.db$/);
  expect(db.bytes.subarray(0, 15).toString()).toBe('SQLite format 3');
  const minis = await download('Miniatures (.csv)');
  expect(minis.bytes.toString()).toContain('name,group,status,models,tags');
  const paints = await download('Paints (.csv)');
  expect(paints.bytes.toString()).toContain('brand,range,name,type,color,stock,notes');
});

test('install details are shown', async ({ page }) => {
  await page.goto('/settings');
  const about = page.locator('section').filter({ has: page.getByRole('heading', { name: 'About this install' }) });
  await expect(about.getByText(/^v\d+$/)).toBeVisible();
  await expect(about.getByText('mock · mock-1')).toBeVisible();
  await expect(about.getByText('HTTP', { exact: true })).toBeVisible();
  // 127.0.0.1 counts as a secure origin for browsers, so installation is offered here.
  const install = page.getByRole('heading', { name: 'Install as an app' }).locator('xpath=ancestor::section[1]');
  await expect(install.getByText(/This connection is secure|only allow installation over HTTPS/)).toBeVisible();
});
