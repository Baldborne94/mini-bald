// Regenerates the PWA icons from client/public/icon.svg:  node scripts/generate-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const pub = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client/public');
const svg = fs.readFileSync(path.join(pub, 'icon.svg'));
// Maskable icons need a full-bleed background with the artwork inside the safe zone.
const square = Buffer.from(svg.toString().replace('rx="112"', 'rx="0"'));

await sharp(svg, { density: 300 }).resize(192).png().toFile(path.join(pub, 'pwa-192.png'));
await sharp(svg, { density: 300 }).resize(512).png().toFile(path.join(pub, 'pwa-512.png'));
await sharp(square, { density: 300 }).resize(180).png().toFile(path.join(pub, 'apple-touch-icon.png'));
await sharp(square, { density: 300 })
  .resize(400)
  .extend({ top: 56, bottom: 56, left: 56, right: 56, background: '#14101f' })
  .png()
  .toFile(path.join(pub, 'pwa-maskable-512.png'));
console.log('Icons written to', pub);
