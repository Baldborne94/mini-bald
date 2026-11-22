import { expect, test, uid } from '../fixtures';

// The suite runs the server with AI_PROVIDER=mock: canned answers, no paid API calls.

test('a recipe suggestion is saved as a normal recipe @phone', async ({ page, api }) => {
  const mini = await api.mini(`AI recipe ${uid()}`);
  await api.photo(mini.id);
  await page.goto(`/minis/${mini.id}`);
  const assistant = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Assistant' }) });
  await expect(assistant.getByText(/Sends this miniature's details, your paint list and the selected photo to mock/)).toBeVisible();
  await assistant.getByPlaceholder(/dark green armour/).fill('Dark green');
  await assistant.getByRole('button', { name: 'Suggest a recipe' }).click();
  await assistant.getByRole('button', { name: 'Save as recipe' }).click();
  await expect(assistant.getByText("Saved to this miniature's recipes")).toBeVisible();
  const recipes = await api.get(`/recipes?miniature=${mini.id}`);
  expect(recipes[0].source).toBe('ai');
  expect(recipes[0].name).toContain('Dark green');
});

test('feedback needs a photo and returns strengths, fixes and a next step', async ({ page, api }) => {
  const mini = await api.mini(`AI feedback ${uid()}`);
  await page.goto(`/minis/${mini.id}`);
  const assistant = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Assistant' }) });
  await assistant.getByRole('tab', { name: 'Give me feedback' }).click();
  await expect(assistant.getByText(/Add a photo below first/)).toBeVisible();
  await expect(assistant.getByRole('button', { name: 'Review this photo' })).toBeDisabled();

  await api.photo(mini.id);
  await page.reload();
  await assistant.getByRole('tab', { name: 'Give me feedback' }).click();
  await assistant.getByRole('button', { name: 'Review this photo' }).click();
  await expect(assistant.getByText('Next session')).toBeVisible();
  await expect(assistant.getByText('What works')).toBeVisible();
});

test('tutorial links open outside the app, and answers can be deleted', async ({ page, api }) => {
  const mini = await api.mini(`AI tutorials ${uid()}`);
  await page.goto(`/minis/${mini.id}`);
  const assistant = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Assistant' }) });
  await assistant.getByRole('tab', { name: 'Find tutorials' }).click();
  await assistant.getByRole('button', { name: 'Search the web' }).click();
  const link = assistant.getByRole('link', { name: /Example painting guide/ });
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);

  await page.reload();
  await assistant.getByRole('button', { name: /Tutorials/ }).click();
  await assistant.getByRole('button', { name: 'Delete' }).click();
  await expect(assistant.getByRole('button', { name: /Tutorials/ })).toHaveCount(0);
});
