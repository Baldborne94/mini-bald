import type { Page } from '@playwright/test';
import { expect, test, uid } from '../fixtures';

/** The recipe card titled `name` (the miniature page is itself an <article>, so go from the heading up). */
const recipeCard = (page: Page, name: string) => page.getByRole('heading', { name, exact: true }).locator('xpath=ancestor::article[1]');

test('write a recipe linked to the inventory, tick steps, edit without losing ticks', async ({ page, api }) => {
  const id = uid();
  const brand = `Rec ${id}`;
  await api.paint(brand, 'Deep Blue');
  const mini = await api.mini(`Recipe mini ${id}`);
  await page.goto(`/minis/${mini.id}`);

  await page.getByRole('button', { name: 'New recipe' }).click();
  const editor = page.getByRole('dialog', { name: 'New recipe' });
  await editor.getByLabel('Name', { exact: true }).fill('Blue armour');
  await editor.getByLabel('Step 1 area').fill('Armour');
  await editor.getByLabel('Step 1 paint').fill(`${brand} Deep Blue`);
  await editor.getByLabel('Step 1 technique').fill('Basecoat');
  await editor.getByRole('button', { name: 'Add step' }).click();
  await editor.getByLabel('Step 2 area').fill('Recesses');
  await editor.getByLabel('Step 2 paint').fill(`Mystery Wash ${id}`);
  await editor.getByRole('button', { name: 'Save recipe' }).click();
  await expect(editor).toBeHidden();

  const card = recipeCard(page, 'Blue armour');
  await expect(card.getByText('0/2')).toBeVisible();
  await expect(card.getByText('not in inventory')).toBeVisible();
  // The tick box is drawn by the step's label: tap the step, as a person would.
  await card.getByRole('listitem').first().locator('label').click();
  await expect(card.getByText('1/2')).toBeVisible();

  // Missing paints go to the shopping list in one tap.
  await card.getByRole('button', { name: 'Add to shopping list' }).click();
  await expect(card.getByText('1 item on the shopping list')).toBeVisible();

  // Reorder: the ticked step keeps its tick.
  await card.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('dialog', { name: 'Edit recipe' }).getByRole('button', { name: 'Move up' }).nth(1).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save recipe' }).click();
  const recipe = (await api.get(`/recipes?miniature=${mini.id}`))[0];
  expect(recipe.steps.map((s: { area: string }) => s.area)).toEqual(['Recesses', 'Armour']);
  expect(recipe.steps[1].doneAt).toBeTruthy();
  expect(recipe.steps[1].paint.name).toBe('Deep Blue');
});

test('copy a recipe to another miniature, save it to the library and reuse it', async ({ page, api }) => {
  const id = uid();
  const from = await api.mini(`Source ${id}`);
  const to = await api.mini(`Target ${id}`);
  const third = await api.mini(`Third ${id}`);
  await api.post('/recipes', { name: `Scheme ${id}`, miniatureId: from.id, steps: [{ phase: 'base', paintLabel: 'Any Paint' }, { phase: 'shade', paintLabel: 'Any Wash' }] });

  await page.goto(`/minis/${from.id}`);
  const card = recipeCard(page, `Scheme ${id}`);
  await card.getByRole('button', { name: 'Copy to…' }).click();
  await page.getByRole('dialog', { name: 'Copy recipe' }).getByLabel('Miniature').selectOption(String(to.id));
  await page.getByRole('dialog').getByRole('button', { name: 'Copy recipe' }).click();
  await expect.poll(async () => (await api.get(`/recipes?miniature=${to.id}`)).length).toBe(1);

  await card.getByRole('button', { name: 'Save to library' }).click();
  await expect(card.getByText('Saved to the recipe library')).toBeVisible();
  await page.goto('/recipes');
  await expect(page.getByRole('heading', { name: `Scheme ${id}` }).first()).toBeVisible();

  await page.goto(`/minis/${third.id}`);
  await page.getByRole('button', { name: 'From library' }).click();
  await page.getByRole('dialog', { name: 'Recipe library' }).getByRole('button', { name: new RegExp(`Scheme ${id}`) }).first().click();
  await expect(recipeCard(page, `Scheme ${id}`)).toBeVisible();

  await recipeCard(page, `Scheme ${id}`).getByRole('button', { name: 'Delete recipe' }).click();
  await expect(page.getByRole('heading', { name: `Scheme ${id}` })).toHaveCount(0);
});

test('bench mode walks through the steps one at a time @phone', async ({ page, api }) => {
  const mini = await api.mini(`Bench ${uid()}`);
  await api.post('/recipes', {
    name: 'Three steps',
    miniatureId: mini.id,
    steps: [
      { phase: 'base', area: 'Cloak', paintLabel: 'Red', technique: 'Basecoat' },
      { phase: 'shade', area: 'Folds', paintLabel: 'Wash' },
      { phase: 'highlight', area: 'Edges', paintLabel: 'Pink' },
    ],
  });
  await page.goto(`/minis/${mini.id}`);
  await page.getByRole('button', { name: 'Bench mode' }).click();
  const bench = page.getByRole('dialog', { name: 'Bench mode: Three steps' });
  await expect(bench.getByText('Step 1 of 3')).toBeVisible();
  await expect(bench.getByRole('heading', { name: 'Cloak' })).toBeVisible();

  await bench.getByRole('button', { name: 'Done, next' }).click();
  await expect(bench.getByText('Step 2 of 3')).toBeVisible();
  await bench.getByRole('button', { name: 'Skip this step' }).click();
  await expect(bench.getByText('Step 3 of 3')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(bench.getByText('Step 2 of 3')).toBeVisible();

  await bench.getByRole('button', { name: 'Start timer' }).click();
  await expect(bench.getByText(/\d:\d\d:\d\d/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bench).toBeHidden();
  const steps = (await api.get(`/recipes?miniature=${mini.id}`))[0].steps;
  expect(steps.map((s: { doneAt: string | null }) => Boolean(s.doneAt))).toEqual([true, false, false]);
  await api.stopTimer();
});
