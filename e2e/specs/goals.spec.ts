import { expect, test, uid } from '../fixtures';

const logToday = (api: import('../fixtures').Api, miniatureId: number, minutes = 25) => {
  const end = new Date();
  return api.post('/sessions', { miniatureId, startedAt: new Date(end.getTime() - minutes * 60_000).toISOString(), endedAt: end.toISOString() });
};

test('painting today keeps the streak and shows on the dashboard @phone', async ({ page, api }) => {
  const mini = await api.mini(`Streak ${uid()}`);
  await logToday(api, mini.id);
  await page.goto('/');
  await expect(page.getByText('Painted today. The streak is safe.')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Last 14 days' }).getByRole('listitem')).toHaveCount(14);
});

test('a challenge on specific miniatures completes when they are finished', async ({ page, api }) => {
  const mini = await api.mini(`Challenge target ${uid()}`, { status: 'primed' });
  await page.goto('/goals');
  await page.getByRole('button', { name: 'New challenge' }).click();
  const dialog = page.getByRole('dialog', { name: 'New challenge' });
  await dialog.getByLabel('What is the challenge?').selectOption('finish_miniatures');
  await dialog.getByRole('checkbox', { name: new RegExp(mini.name) }).check();
  await dialog.getByLabel('Name').fill(`Finish ${mini.name}`);
  await dialog.getByRole('button', { name: 'Start the challenge' }).click();

  const card = page.getByRole('heading', { name: `Finish ${mini.name}` }).locator('xpath=ancestor::article[1]');
  await expect(card.getByText('0 / 1')).toBeVisible();
  await api.post(`/miniatures/${mini.id}/status`, { status: 'finished' });
  await page.reload();
  await expect(card.getByText('Completed')).toBeVisible();
  await expect(card.getByText('1 / 1')).toBeVisible();
});

test('a challenge can be set aside, picked up again and deleted', async ({ page }) => {
  const title = `Paint hours ${uid()}`;
  await page.goto('/goals');
  await page.getByRole('button', { name: 'New challenge' }).click();
  const dialog = page.getByRole('dialog', { name: 'New challenge' });
  await dialog.getByLabel('What is the challenge?').selectOption('paint_hours');
  await dialog.getByRole('spinbutton', { name: 'Hours' }).fill('3');
  await dialog.getByLabel('Name').fill(title);
  await dialog.getByRole('button', { name: 'Start the challenge' }).click();

  const card = page.getByRole('heading', { name: title }).locator('xpath=ancestor::article[1]');
  await expect(card.getByText(/\/ 3/)).toBeVisible();
  await card.getByRole('button', { name: 'Set aside' }).click();
  await expect(card.getByText('Set aside', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Pick up again' }).click();
  await expect(card.getByText(/days left|Last day/)).toBeVisible();
  await card.getByRole('button', { name: 'Delete challenge' }).click();
  await expect(card).toHaveCount(0);
});

test('badges list what is unlocked and the progress of the rest', async ({ page, api }) => {
  await api.mini(`Badge ${uid()}`, { status: 'finished' });
  await page.goto('/goals');
  await expect(page.getByText(/\d+ of 21/)).toBeVisible();
  const first = page.getByRole('listitem').filter({ hasText: 'First of many' });
  await expect(first.getByText(/\d{1,2} \w{3} \d{4}/)).toBeVisible();
  const century = page.getByRole('listitem').filter({ hasText: 'Century' });
  await expect(century.getByTitle(/of 100/)).toBeVisible();
});

test('what do I paint today draws an unfinished miniature and starts the timer @phone', async ({ page, api }) => {
  const tag = `draw${uid()}`;
  const mini = await api.mini(`Lucky ${tag}`, { status: 'primed', tags: [tag] });
  await api.mini(`Done ${tag}`, { status: 'finished', tags: [tag] });
  await page.goto('/pick');
  await page.getByLabel('Tag').selectOption(tag);
  await expect(page.getByText('1 miniature in the draw.')).toBeVisible();
  await page.getByRole('button', { name: 'Roll' }).click();
  await expect(page.getByText('Today it is')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: mini.name })).toBeVisible();
  await page.getByRole('button', { name: 'Start painting' }).click();
  await expect(page).toHaveURL(new RegExp(`/minis/${mini.id}$`));
  await expect(page.getByRole('timer')).toContainText(mini.name);
  await api.stopTimer();
});

test('statistics, painting calendar and the year in paint', async ({ page, api }) => {
  const mini = await api.mini(`Recap ${uid()}`, { status: 'finished' });
  await logToday(api, mini.id, 50);
  const year = new Date().getFullYear();
  await page.goto('/goals');
  await expect(page.getByRole('heading', { name: 'Statistics' })).toBeVisible();
  await expect(page.getByRole('figure').filter({ hasText: 'Models finished' })).toBeVisible();
  const calendar = page.getByRole('heading', { name: 'Painting calendar' }).locator('xpath=ancestor::section[1]');
  await expect(calendar.getByText(new RegExp(`days? painted in ${year}`))).toBeVisible();
  await calendar.getByText('Show as a table').click();
  await expect(calendar.getByRole('table')).toBeVisible();

  await calendar.getByRole('link', { name: `${year} in paint` }).click();
  await expect(page).toHaveURL(new RegExp(`/recap/${year}$`));
  await expect(page.getByRole('heading', { level: 1, name: String(year) })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Off the bench' })).toBeVisible();
  await expect(page.getByRole('link', { name: mini.name, exact: true }).first()).toBeVisible();

  await page.goto('/recap/2001');
  await expect(page.getByText('Nothing recorded in 2001.')).toBeVisible();
});

test('dashboard extras: colour of the day, forgotten paints, pile estimate', async ({ page, api }) => {
  await api.paint(`Dash ${uid()}`, 'Forgotten Teal', { colorHex: '#119988' });
  await api.mini(`Pace ${uid()}`, { status: 'finished' });
  await api.mini(`Still on the pile ${uid()}`);
  await page.goto('/');
  await expect(page.getByText('Colour of the day')).toBeVisible();
  await expect(page.getByText(/At your pace of the last 90 days/)).toBeVisible();
  await page.getByRole('link', { name: /forgotten paints?/ }).click();
  await expect(page).toHaveURL(/\/paints\?unused=1$/);
});
