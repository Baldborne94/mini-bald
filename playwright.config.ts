import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 8199);

/**
 * End-to-end tests: the real app (built client + server) in a real browser, on a fresh data
 * folder, with the mock AI provider. Run with `npm run test:e2e`.
 */
export default defineConfig({
  testDir: 'e2e/specs',
  // One shared database: specs run one at a time, each creating its own data.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
    locale: 'en-GB',
    timezoneId: 'Europe/Rome',
  },
  projects: [
    { name: 'desktop', testIgnore: /lock\.spec/, use: { viewport: { width: 1366, height: 860 } } },
    { name: 'phone', testIgnore: /lock\.spec/, grep: /@phone/, use: { ...devices['Pixel 7'] } },
    // The PIN lock changes access for everyone, so it runs last, on its own.
    { name: 'lock', testMatch: /lock\.spec/, dependencies: ['desktop', 'phone'], use: { viewport: { width: 1366, height: 860 } } },
  ],
  webServer: {
    command: 'node e2e/start-server.mjs',
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
