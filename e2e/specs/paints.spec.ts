import { expect, test, uid } from '../fixtures';

test.describe('inventory', () => {
  // The duplicate check below makes the server answer 409 on purpose; the browser logs it.
  test.use({ allowedErrors: [[/status of 409/], { scope: 'test' }] });

  test('add paints one by one, change stock, delete', async ({ page, api }) => {
  const brand = `Brand ${uid()}`;
  await page.goto('/paints');
  await page.getByRole('button', { name: 'Add paint' }).click();
  const form = page.getByRole('dialog', { name: 'Add paint' });
  await form.getByLabel('Brand').fill(brand);
  await form.getByLabel('Range').fill('Base');
  await form.getByLabel('Name', { exact: true }).fill('Alpha Blue');
  await form.getByRole('button', { name: 'Save & add another' }).click();
  await expect(form.getByText('1 paint added. Keep going.')).toBeVisible();
  // Brand and range stay for the next pot.
  await expect(form.getByLabel('Brand')).toHaveValue(brand);
  await form.getByLabel('Name', { exact: true }).fill('Beta Red');
  await form.getByRole('button', { name: 'Add paint' }).click();
  await expect(form).toBeHidden();
  await expect(page.getByRole('button', { name: 'Edit Alpha Blue' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit Beta Red' })).toBeVisible();

  // Tapping the stock badge cycles it; a low pot goes on the shopping list.
  const alpha = page.locator('div').filter({ has: page.getByRole('button', { name: 'Edit Alpha Blue' }) }).last();
  await alpha.getByTitle('Tap to change stock').click();
  await expect(alpha.getByTitle('Tap to change stock')).toHaveText(/Running low/);
  const paints = await api.get(`/paints?q=${encodeURIComponent(brand)}`);
  expect(paints.find((p: { name: string }) => p.name === 'Alpha Blue').onShoppingList).toBe(true);

  // A duplicate is refused.
  await page.getByRole('button', { name: 'Add paint' }).click();
  await page.getByRole('dialog').getByLabel('Brand').fill(brand);
  await page.getByRole('dialog').getByLabel('Range').fill('Base');
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Alpha Blue');
  await page.getByRole('dialog').getByRole('button', { name: 'Add paint' }).click();
  await expect(page.getByRole('dialog').getByText('This paint is already in your inventory')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Edit Beta Red' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('button', { name: 'Edit Beta Red' })).toHaveCount(0);
  });
});

test('shopping list: free items, buying restocks the paint, clearing bought items @phone', async ({ page, api }) => {
  const id = uid();
  const paint = await api.paint(`Shop ${id}`, 'Low Yellow', { stock: 'low' });
  await page.goto('/paints?tab=shopping');
  await page.getByLabel('New item').fill(`Glue ${id}`);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText(`Glue ${id}`)).toBeVisible();

  // The checkbox is drawn by its label; tap the row as a person would.
  await page.getByRole('listitem').filter({ hasText: `Shop ${id}` }).locator('label').click();
  await expect.poll(async () => (await api.get(`/paints?q=${encodeURIComponent(`Shop ${id}`)}`))[0].stock).toBe('owned');
  await expect(page.getByRole('heading', { name: 'Bought' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByText(`Shop ${id}`)).toHaveCount(0);
  expect(paint.id).toBeGreaterThan(0);
});

test('catalogue: add a whole shelf, a single paint, and a wishlist item found by code', async ({ page, api }) => {
  await page.goto('/paints?tab=catalogue');
  await page.getByRole('button', { name: /^AK Interactive/ }).click();
  await page.getByLabel('Search the catalogue').fill('AK11001');
  await page.getByRole('button', { name: /White/ }).first().click();
  await page.getByRole('button', { name: 'I own these' }).click();
  await expect(page.getByText('1 paint added to your inventory.')).toBeVisible();

  await page.getByLabel('Search the catalogue').fill('WP2028');
  await page.getByRole('main').getByRole('button', { name: /Hoplite Gold/ }).click();
  await page.getByRole('button', { name: 'Wishlist' }).click();
  await expect(page.getByText('1 paint added to your wishlist.')).toBeVisible();
  const shopping = await api.get('/shopping');
  expect(shopping.some((i: { paint: { name: string } | null }) => i.paint?.name === 'Hoplite Gold')).toBe(true);

  await page.getByLabel('Search the catalogue').fill('');
  await page.getByRole('button', { name: /^Citadel/ }).click();
  const shades = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Shade/ }) });
  await shades.getByRole('button', { name: /^Select all/ }).click();
  const selected = Number((await page.getByText(/\d+ selected/).innerText()).match(/\d+/)![0]);
  expect(selected).toBeGreaterThan(10);
  await page.getByRole('button', { name: 'I own these' }).click();
  await expect(page.getByText(`${selected} paints added to your inventory.`)).toBeVisible();
  // Owned paints are ticked and can't be picked again.
  await expect(shades.getByRole('button', { name: /^Select all/ })).toHaveCount(0);
});

test('import from pasted CSV with Italian headers, then export', async ({ page, request }) => {
  const id = uid();
  await page.goto('/paints');
  await page.getByRole('button', { name: 'Import' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import paints' });
  await dialog.getByLabel('…or paste here').fill(`Marca;Gamma;Nome;Colore;Stato\nCSV ${id};Base;Imported One;#aa3355;\nCSV ${id};Base;Imported Two;;sta finendo\n;;;;\nCSV ${id};Base;Imported One;;`);
  await expect(dialog.getByText('2 paints ready to import')).toBeVisible();
  await expect(dialog.getByText('1 row skipped')).toBeVisible();
  await dialog.getByRole('button', { name: 'Import 2' }).click();
  await expect(dialog.getByText('2 paints added.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();

  const csv = await (await request.get('/api/paints/export.csv')).text();
  expect(csv).toContain(`CSV ${id},Base,Imported One,,#aa3355,owned,`);
  expect(csv).toContain(`CSV ${id},Base,Imported Two,,,low,`);
});

test('the paint form fills range, type and colour from the catalogue', async ({ page }) => {
  await page.goto('/paints');
  await page.getByRole('button', { name: 'Add paint' }).click();
  const form = page.getByRole('dialog', { name: 'Add paint' });
  await form.getByLabel('Brand').fill('Citadel');
  await form.getByLabel('Name', { exact: true }).fill('wraithbone');
  await expect(form.getByLabel('Name', { exact: true })).toHaveValue('Wraithbone');
  await expect(form.getByLabel('Range')).toHaveValue('Base');
  await expect(form.getByLabel('Paint colour')).not.toHaveValue('#888888');
});

test('fill missing colours from the catalogue, and the never-used filter', async ({ page, api }) => {
  await api.paint('The Army Painter', 'Pallid Bone', { range: 'Speedpaint 2.0' });
  const used = await api.paint(`Used ${uid()}`, 'In A Recipe');
  const mini = await api.mini(`Recipe holder ${uid()}`);
  await api.post('/recipes', { name: 'Uses it', miniatureId: mini.id, steps: [{ phase: 'base', paintId: used.id }] });

  await page.goto('/paints');
  await page.getByRole('button', { name: 'Fill missing colours' }).click();
  await expect(page.getByText(/coloured from the catalogue/)).toBeVisible();
  const pallid = (await api.get('/paints?q=Pallid')).find((p: { name: string }) => p.name === 'Pallid Bone');
  expect(pallid.colorHex).toMatch(/^#[0-9a-f]{6}$/);

  await page.goto('/paints?unused=1');
  await expect(page.getByRole('button', { name: /^Never used/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Edit Pallid Bone' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit In A Recipe' })).toHaveCount(0);
});
