import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
import sharp from 'sharp';

/** Unique suffix so every test works on its own data in the shared database. */
export const uid = () => Math.random().toString(36).slice(2, 7);

/** A small, valid JPEG of one colour, for photo uploads. */
export async function jpeg(color = '#c0392b', width = 800, height = 1000) {
  const buffer = await sharp({ create: { width, height, channels: 3, background: color } }).jpeg({ quality: 80 }).toBuffer();
  return { name: `photo-${uid()}.jpg`, mimeType: 'image/jpeg', buffer };
}

/** Thin wrapper over the REST API, to set up data quickly instead of clicking through forms. */
export class Api {
  constructor(private request: APIRequestContext) {}

  private async call<T>(method: 'get' | 'post' | 'patch' | 'put' | 'delete', url: string, data?: unknown): Promise<T> {
    const res = await this.request[method](`/api${url}`, data === undefined ? {} : { data });
    expect(res.ok(), `${method.toUpperCase()} ${url} -> ${res.status()} ${await res.text()}`).toBeTruthy();
    return (res.status() === 204 ? undefined : await res.json()) as T;
  }
  get = <T = any>(url: string) => this.call<T>('get', url);
  post = <T = any>(url: string, data: unknown = {}) => this.call<T>('post', url, data);
  patch = <T = any>(url: string, data: unknown) => this.call<T>('patch', url, data);
  put = <T = any>(url: string, data: unknown) => this.call<T>('put', url, data);
  delete = (url: string) => this.call<void>('delete', url);

  group = (name: string, extra: object = {}) => this.post('/groups', { name, ...extra });
  mini = (name: string, extra: object = {}) => this.post('/miniatures', { name, ...extra });
  paint = (brand: string, name: string, extra: object = {}) => this.post('/paints', { brand, name, ...extra });
  async photo(miniatureId: number, color?: string) {
    const file = await jpeg(color);
    const res = await this.request.post(`/api/miniatures/${miniatureId}/photos`, {
      multipart: { file: { name: file.name, mimeType: file.mimeType, buffer: file.buffer } },
    });
    expect(res.ok(), `photo upload -> ${res.status()}`).toBeTruthy();
    return (await res.json())[0];
  }
  stopTimer = () => this.post('/sessions/stop');
}

interface Fixtures {
  api: Api;
  /** Push answers here before triggering a prompt() dialog; confirm() dialogs are accepted. */
  answers: string[];
  /** Console errors that are expected in a test (for example 401s while locked). */
  allowedErrors: RegExp[];
  /** 'dismiss' closes the "finished" celebration automatically; 'keep' leaves it for the test. */
  celebrations: 'dismiss' | 'keep';
}

export const test = base.extend<Fixtures>({
  answers: async ({}, use) => {
    await use([]);
  },
  allowedErrors: [[], { option: true }],
  celebrations: ['dismiss', { option: true }],

  api: async ({ request }, use) => {
    await use(new Api(request));
  },

  page: async ({ page, answers, allowedErrors, celebrations }, use, testInfo) => {
    // Every page must stay free of uncaught errors and console errors.
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !allowedErrors.some((re) => re.test(m.text()))) errors.push(`console: ${m.text()}`);
    });
    page.on('dialog', (d) => void (d.type() === 'prompt' ? d.accept(answers.shift() ?? '') : d.accept()));

    // Badges unlock as a side effect of almost anything; collect them whenever they get in the way.
    // Several badges can unlock at once and follow each other in the same overlay, so the handler
    // does not wait for it to disappear: it simply runs again while badges keep coming.
    await page.addLocatorHandler(
      page.getByRole('dialog', { name: 'Badge unlocked' }),
      async (overlay) => {
        // The same overlay switches to "Miniature finished" when that arrives: then there is no
        // badge left to collect, and the test (or the other handler) deals with it.
        await overlay.getByRole('button', { name: 'Collect' }).click({ timeout: 2_000 }).catch(() => {});
      },
      { noWaitAfter: true },
    );
    if (celebrations === 'dismiss') {
      await page.addLocatorHandler(
        page.getByRole('dialog', { name: 'Miniature finished' }),
        async (overlay) => {
          await overlay.getByRole('button', { name: 'Nice' }).click({ timeout: 2_000 }).catch(() => {});
        },
        { noWaitAfter: true },
      );
    }

    await use(page);
    expect(errors, `errors on the page during "${testInfo.title}"`).toEqual([]);
  },
});

export { expect };

/** Fails if the page scrolls sideways: the layout must fit the viewport. */
export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `page is ${overflow}px wider than the viewport`).toBeLessThanOrEqual(1);
}

/** Every visible button and link needs a name a screen reader can read. */
export async function expectNamedControls(page: Page) {
  const unnamed = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button, a[href], [role="button"]'))
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .filter((el) => !(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent?.trim() || el.querySelector('img[alt]:not([alt=""])')))
      .map((el) => el.outerHTML.slice(0, 120)),
  );
  expect(unnamed, 'controls without an accessible name').toEqual([]);
}
