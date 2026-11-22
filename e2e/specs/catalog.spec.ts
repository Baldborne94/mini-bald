import { expect, expectNoHorizontalOverflow, jpeg, test, uid } from '../fixtures';

test.describe('groups', () => {
  test('create a group and a sub-group, rename, delete keeps the miniatures', async ({ page, api }) => {
    const id = uid();
    await page.goto('/groups');
    await page.getByRole('button', { name: 'New group' }).click();
    const dialog = page.getByRole('dialog', { name: 'New group' });
    await dialog.getByLabel('Name').fill(`Grimdark ${id}`);
    await dialog.getByLabel('Kind (free text)').fill('Game system');
    await dialog.getByRole('button', { name: 'Create group' }).click();
    const card = page.locator('section').filter({ has: page.getByRole('heading', { name: `Grimdark ${id}` }) });
    await expect(card).toBeVisible();
    await expect(card.getByText('Game system')).toBeVisible();

    // A sub-group starts inside the group it was created from.
    await card.getByRole('button', { name: 'Sub-group' }).click();
    await expect(page.getByRole('dialog', { name: 'New group' }).getByLabel('Inside')).toHaveValue(/\d+/);
    await page.getByRole('dialog').getByLabel('Name').fill(`Blue Knights ${id}`);
    await page.getByRole('dialog').getByRole('button', { name: 'Create group' }).click();
    await expect(card.getByRole('link', { name: new RegExp(`Blue Knights ${id}`) })).toBeVisible();

    await card.getByRole('button', { name: `Edit Blue Knights ${id}` }).click();
    await page.getByRole('dialog', { name: 'Edit group' }).getByLabel('Name').fill(`Red Knights ${id}`);
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(card.getByRole('link', { name: new RegExp(`Red Knights ${id}`) })).toBeVisible();

    // Deleting a group never deletes what is filed in it.
    const groups = await api.get('/groups');
    const child = groups.find((g: { name: string }) => g.name === `Red Knights ${id}`);
    const mini = await api.mini(`Sergeant ${id}`, { groupId: child.id });
    await card.getByRole('button', { name: `Edit Red Knights ${id}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(card.getByRole('link', { name: new RegExp(`Red Knights ${id}`) })).toHaveCount(0);
    expect((await api.get(`/miniatures/${mini.id}`)).group).toBeNull();
  });

  test('groups cannot be nested two levels deep', async ({ api, request }) => {
    const top = await api.group(`Top ${uid()}`);
    const mid = await api.group(`Mid ${uid()}`, { parentId: top.id });
    const res = await request.post('/api/groups', { data: { name: 'Too deep', parentId: mid.id } });
    expect(res.status()).toBe(400);
  });
});

test.describe('miniatures', () => {
  test('add a miniature with group, quantity, status and tags, then edit it @phone', async ({ page, api }) => {
    const id = uid();
    const group = await api.group(`Orruks ${id}`);
    await page.goto('/minis/new');
    await page.getByLabel('Name').fill(`Brute Squad ${id}`);
    await page.getByLabel('Group').selectOption(String(group.id));
    await page.getByLabel('Models in this card').fill('5');
    await page.getByRole('group', { name: 'Where is it now?' }).getByText('Primed').click();
    const tags = page.getByPlaceholder('Add tags (Enter or comma)');
    await tags.fill('Infantry,');
    await page.getByPlaceholder('Add…').fill('Battleline');
    await page.getByPlaceholder('Add…').press('Enter');
    await page.getByLabel('Description').fill('Five brutes with choppas.');
    await page.getByRole('button', { name: 'Add to the collection' }).click();

    await expect(page).toHaveURL(/\/minis\/\d+$/);
    await expect(page.getByRole('heading', { level: 1, name: `Brute Squad ${id}` })).toBeVisible();
    await expect(page.getByText('5 models')).toBeVisible();
    await expect(page.getByRole('link', { name: '#Infantry' })).toBeVisible();
    await expect(page.getByRole('link', { name: '#Battleline' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Primed' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('Five brutes with choppas.')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole('link', { name: 'Edit' }).click();
    await expect(page.getByLabel('Name')).toHaveValue(`Brute Squad ${id}`);
    await page.getByLabel('Name').fill(`Gore Squad ${id}`);
    await page.getByLabel('Notes').fill('Highlight the armour plates.');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('heading', { level: 1, name: `Gore Squad ${id}` })).toBeVisible();
    await expect(page.getByText('Highlight the armour plates.')).toBeVisible();
    // The photo folder follows the new name.
    await expect(page.getByText(new RegExp(`photos/orruks-${id}/gore-squad-${id}-\\d+/`))).toBeVisible();
  });

  test('a miniature needs a name', async ({ page }) => {
    await page.goto('/minis/new');
    await page.getByRole('button', { name: 'Add to the collection' }).click();
    await expect(page).toHaveURL(/\/minis\/new$/);
    expect(await page.getByLabel('Name').evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
  });

  test('search, filter by status, group and tag, sort and switch to list view', async ({ page, api }) => {
    const id = uid();
    const group = await api.group(`Filters ${id}`);
    await api.mini(`Alpha ${id}`, { groupId: group.id, status: 'in_progress', tags: [`tag${id}`] });
    await api.mini(`Bravo ${id}`, { groupId: group.id, status: 'primed' });
    await api.mini(`Charlie ${id}`, { status: 'finished' });

    await page.goto('/minis');
    await page.getByLabel('Search').fill(id);
    const cards = page.getByRole('main').getByRole('link', { name: new RegExp(id) });
    await expect(cards).toHaveCount(3);
    await expect(page).toHaveURL(new RegExp(`q=${id}`));

    await page.getByRole('button', { name: 'In progress' }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText(`Alpha ${id}`);
    await page.getByRole('button', { name: 'Primed' }).click();
    await expect(cards).toHaveCount(2);
    await page.getByRole('button', { name: 'Clear' }).click();

    await page.getByLabel('Search').fill(id);
    await page.getByLabel('Group').selectOption(String(group.id));
    await expect(cards).toHaveCount(2);
    await page.getByLabel('Tag').selectOption(`tag${id}`);
    await expect(cards).toHaveCount(1);
    await page.getByLabel('Tag').selectOption('');
    await page.getByLabel('Sort').selectOption('name');
    await expect(cards.first()).toContainText(`Alpha ${id}`);

    // The view choice is remembered on the device.
    await page.getByRole('button', { name: 'List view' }).click();
    await expect(page.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true');
    await expect(cards).toHaveCount(2);

    await page.getByLabel('Search').fill(`nothing-matches-${id}`);
    await expect(page.getByText('Nothing matches these filters.')).toBeVisible();
  });

  test('delete a miniature', async ({ page, api }) => {
    const mini = await api.mini(`Doomed ${uid()}`);
    await page.goto(`/minis/${mini.id}`);
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page).toHaveURL(/\/minis$/);
    const res = await page.request.get(`/api/miniatures/${mini.id}`);
    expect(res.status()).toBe(404);
  });
});

test.describe('status', () => {
  test.use({ celebrations: 'keep' });

  test('moving through the stages records dates and finishing is celebrated', async ({ page, api }) => {
    const mini = await api.mini(`Champion ${uid()}`, { status: 'primed' });
    await page.goto(`/minis/${mini.id}`);
    await page.getByRole('radio', { name: 'In progress' }).click();
    await expect(page.getByRole('radio', { name: 'In progress' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('Started', { exact: true })).toBeVisible();

    await page.getByRole('radio', { name: 'Finished' }).click();
    const party = page.getByRole('dialog', { name: 'Miniature finished' });
    await expect(party).toBeVisible();
    await expect(party.getByRole('heading', { name: `${mini.name} is finished!` })).toBeVisible();
    await party.getByRole('button', { name: 'Nice' }).click();
    await expect(party).toBeHidden();
    await expect(page.getByText('Finished', { exact: true }).first()).toBeVisible();
    const history = await api.get(`/miniatures/${mini.id}`);
    expect(history.finishedAt).toBeTruthy();
  });
});

test('the dashboard reflects the collection @phone', async ({ page, api }) => {
  const before = await api.get('/dashboard');
  await api.mini(`Pile ${uid()}`, { quantity: 4 });
  await page.goto('/');
  await expect(page.getByText(`${before.pile + 4}`, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Pick up where you left off')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('uploading a photo from the phone camera input @phone', async ({ page, api }) => {
  const mini = await api.mini(`Camera ${uid()}`);
  await page.goto(`/minis/${mini.id}`);
  await page.locator('input[capture]').setInputFiles(await jpeg('#2b3fe0'));
  await expect(page.getByRole('button', { name: /^Open photo/ })).toHaveCount(1);
});
