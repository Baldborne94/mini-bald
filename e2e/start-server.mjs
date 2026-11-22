// Starts the built server on a fresh, throwaway data folder for the end-to-end tests.
// Plain Node so it works the same on Windows, macOS and Linux.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = path.join(root, 'e2e', '.data');
fs.rmSync(data, { recursive: true, force: true });

Object.assign(process.env, {
  DATA_DIR: data,
  PORT: process.env.E2E_PORT ?? '8199',
  HOST: '127.0.0.1',
  // Canned AI answers: the suite never calls a paid API.
  AI_PROVIDER: 'mock',
  ANTHROPIC_API_KEY: '',
  BACKUP_KEEP: '0',
  LOG: 'off',
  TZ: 'Europe/Rome',
});

const entry = path.join(root, 'server', 'dist', 'index.js');
if (!fs.existsSync(entry)) {
  console.error('server/dist/index.js is missing: run "npm run build" first.');
  process.exit(1);
}
await import(pathToFileURL(entry).href);
