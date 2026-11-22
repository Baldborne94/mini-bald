import { expect, jpeg, test, uid } from '../fixtures';

test('upload several photos, caption one, choose the cover, delete one', async ({ page, api }) => {
  const mini = await api.mini(`Photogenic ${uid()}`);
  await page.goto(`/minis/${mini.id}`);
  await expect(page.getByText(/Take the "before" shot now/)).toBeVisible();
  await page.locator('input[type=file][multiple]').setInputFiles([await jpeg('#aa3355'), await jpeg('#33aa55')]);
  const shots = page.getByRole('button', { name: /^Open photo/ });
  await expect(shots).toHaveCount(2);

  await shots.first().click();
  const viewer = page.getByRole('dialog', { name: '1 / 2' });
  await expect(viewer).toBeVisible();
  await viewer.getByLabel('Caption').fill('First glaze on the cloak');
  await viewer.getByLabel('Caption').press('Enter');
  await viewer.getByRole('button', { name: 'Use as cover' }).click();
  await expect(viewer.getByRole('button', { name: 'Cover photo' })).toBeVisible();
  await expect.poll(async () => (await api.get(`/miniatures/${mini.id}`)).hasExplicitCover).toBe(true);
  expect((await api.get(`/miniatures/${mini.id}`)).photos.some((p: { caption: string }) => p.caption === 'First glaze on the cloak')).toBe(true);

  // Arrow keys move between photos.
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('dialog', { name: '2 / 2' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('dialog', { name: '1 / 1' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await expect(shots).toHaveCount(1);
});

test.describe('refused uploads', () => {
  // The browser logs the refused request itself; that one error is expected here.
  test.use({ allowedErrors: [[/status of 415/], { scope: 'test' }] });

  test('a file that is not an image is refused with a clear message', async ({ page, api }) => {
  const mini = await api.mini(`Not a photo ${uid()}`);
  await page.goto(`/minis/${mini.id}`);
  await page.locator('input[type=file][multiple]').setInputFiles({ name: 'notes.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not an image') });
  await expect(page.getByText(/Upload failed/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Open photo/ })).toHaveCount(0);
  });
});

test('before/after compare between two photos @phone', async ({ page, api }) => {
  const mini = await api.mini(`Glow up ${uid()}`);
  await api.photo(mini.id, '#888888');
  await api.photo(mini.id, '#d81e6f');
  await page.goto(`/minis/${mini.id}`);
  await page.getByRole('button', { name: 'Compare' }).click();
  const compare = page.getByRole('dialog', { name: 'Before / after' });
  await expect(compare.getByRole('img', { name: /^Before/ })).toBeVisible();
  await compare.getByLabel('Slide between before and after').fill('25');
  await expect(compare.getByRole('combobox', { name: /^Before/ })).toBeVisible();
  await expect(compare.getByRole('img', { name: /^After/ })).toBeVisible();
});

test('photos are served as thumbnails and originals, and missing ones give 404', async ({ api, request }) => {
  const mini = await api.mini(`Thumbs ${uid()}`);
  const photo = await api.photo(mini.id);
  const thumb = await request.get(`/api/media/thumbs/${photo.id}?w=200`);
  expect(thumb.headers()['content-type']).toBe('image/webp');
  expect((await request.get(`/api/media/photos/${photo.id}`)).headers()['content-type']).toBe('image/jpeg');
  expect((await request.get('/api/media/photos/999999')).status()).toBe(404);
  expect((await request.get('/api/media/photos/abc')).status()).toBe(400);
});
