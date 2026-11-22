import { expect, test, uid } from '../fixtures';

test.afterEach(async ({ api }) => {
  await api.stopTimer();
});

test('start the timer, follow it across pages, stop it from the pill @phone', async ({ page, api }) => {
  const mini = await api.mini(`Timer ${uid()}`);
  await page.goto(`/minis/${mini.id}`);
  await page.getByRole('button', { name: 'Start painting' }).click();
  await expect(page.getByText('Painting now')).toBeVisible();
  const pill = page.getByRole('timer', { name: 'Painting session' });
  await expect(pill).toContainText(mini.name);

  await page.goto('/paints');
  await expect(pill).toBeVisible();
  await pill.getByRole('button', { name: 'Stop the timer' }).click();
  await expect(pill).toBeHidden();
  expect((await api.get(`/sessions?miniature=${mini.id}`)).length).toBe(1);
});

test('log time afterwards, add a note, correct the duration, delete', async ({ page, api, answers }) => {
  const mini = await api.mini(`Logbook ${uid()}`);
  await page.goto(`/minis/${mini.id}`);
  await page.getByLabel('Minutes to log').fill('45');
  await page.getByRole('button', { name: 'Log time' }).click();
  await expect(page.getByTitle('Correct the duration')).toHaveText('45m');

  answers.push('Base coats done');
  await page.getByRole('button', { name: 'Add a note' }).click();
  await expect(page.getByRole('button', { name: 'Base coats done' })).toBeVisible();

  answers.push('30');
  await page.getByTitle('Correct the duration').click();
  await expect(page.getByTitle('Correct the duration')).toHaveText('30m');

  await page.getByRole('button', { name: 'Delete session' }).click();
  await expect(page.getByTitle('Correct the duration')).toHaveCount(0);
});

test('starting a timer on another miniature stops the first one', async ({ page, api }) => {
  const first = await api.mini(`First ${uid()}`);
  const second = await api.mini(`Second ${uid()}`);
  await api.post('/sessions/start', { miniatureId: first.id });
  await page.goto(`/minis/${second.id}`);
  await expect(page.getByText(/A timer is running on/)).toBeVisible();
  await page.getByRole('button', { name: 'Start painting' }).click();
  await expect(page.getByRole('timer')).toContainText(second.name);
  const firstSessions = await api.get(`/sessions?miniature=${first.id}`);
  expect(firstSessions[0].endedAt).toBeTruthy();
});
