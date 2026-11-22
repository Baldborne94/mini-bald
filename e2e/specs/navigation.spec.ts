import { expect, expectNamedControls, expectNoHorizontalOverflow, test } from '../fixtures';

const PAGES = [
  { path: '/', heading: /Pile of shame|The bench is empty/i },
  { path: '/minis', heading: 'Miniatures' },
  { path: '/minis/new', heading: 'What did you get?' },
  { path: '/groups', heading: 'Groups' },
  { path: '/paints', heading: 'Paints' },
  { path: '/paints?tab=catalogue', heading: 'Paints' },
  { path: '/paints?tab=shopping', heading: 'Paints' },
  { path: '/recipes', heading: 'Recipes' },
  { path: '/goals', heading: 'Goals' },
  { path: '/pick', heading: 'What do I paint today?' },
  { path: '/recap', heading: /^\d{4}$/ },
  { path: '/settings', heading: 'Settings' },
];

test.describe('every page', () => {
  test.beforeAll(async ({ request }) => {
    // Some content, so pages render their full layout rather than empty states.
    await request.post('/api/miniatures', { data: { name: 'Navigation sample', status: 'in_progress' } });
  });

  for (const { path, heading } of PAGES) {
    test(`${path} loads, fits the screen and names its controls @phone`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectNamedControls(page);
    });
  }

  test('an unknown address shows a friendly message', async ({ page }) => {
    await page.goto('/no/such/page');
    await expect(page.getByText('Nothing on this shelf.')).toBeVisible();
  });
});

test('the main navigation reaches every section @phone', async ({ page, isMobile }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: 'Minis' }).click();
  await expect(page).toHaveURL(/\/minis$/);
  await nav.getByRole('link', { name: 'Paints' }).click();
  await expect(page).toHaveURL(/\/paints$/);
  if (isMobile) {
    // On phones the rest sits behind "More".
    await nav.getByRole('link', { name: 'More' }).click();
    for (const name of ['Goals', 'Recipes', 'Groups', 'Settings']) await expect(page.getByRole('main').getByRole('link', { name })).toBeVisible();
    await page.getByRole('main').getByRole('link', { name: 'Groups' }).click();
  } else {
    await nav.getByRole('link', { name: 'Groups' }).click();
  }
  await expect(page).toHaveURL(/\/groups$/);
  await page.getByRole('link', { name: 'Add miniature' }).click();
  await expect(page).toHaveURL(/\/minis\/new$/);
  await nav.getByRole('link', { name: 'Bench' }).click();
  await expect(page).toHaveURL(/\/$/);
});
