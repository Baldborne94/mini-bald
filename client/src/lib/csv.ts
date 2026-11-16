import { PAINT_STOCKS, type PaintInput, type PaintStock } from '@minibald/shared';

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

// Accepted header names, English and Italian, so a spreadsheet you already keep can be used as it is.
const HEADERS: Record<string, keyof Columns> = {
  brand: 'brand', marca: 'brand', manufacturer: 'brand',
  range: 'range', gamma: 'range', line: 'range', linea: 'range',
  name: 'name', nome: 'name', paint: 'name', colour: 'name', vernice: 'name',
  type: 'type', tipo: 'type',
  color: 'color', hex: 'color', colore: 'color',
  stock: 'stock', stato: 'stock', status: 'stock',
  notes: 'notes', note: 'notes',
};
interface Columns { brand: number; range: number; name: number; type: number; color: number; stock: number; notes: number }
const STOCK_WORDS: Record<string, PaintStock> = {
  low: 'low', 'running low': 'low', 'sta finendo': 'low',
  out: 'out', empty: 'out', finita: 'out', finito: 'out',
  wanted: 'wanted', wishlist: 'wanted', 'da comprare': 'wanted',
};

export interface CsvImport {
  items: PaintInput[];
  /** Human-readable reasons for rows that were left out. */
  problems: string[];
}

/**
 * Turns pasted or uploaded CSV into paints. With a header row, columns can be in any order;
 * without one they are read as brand, range, name, type, colour. Excel in Italian separates
 * with semicolons, so the delimiter is detected from the first line.
 */
export function csvToPaints(text: string, fallbackBrand: string): CsvImport {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [';', '\t', ','].find((d) => firstLine.includes(d)) ?? ',';
  const rows = parseCsv(clean, delimiter);
  if (rows.length === 0) return { items: [], problems: [] };

  const header = rows[0]!.map((h) => HEADERS[h.trim().toLowerCase()]);
  const hasHeader = header.includes('name');
  const col: Columns = { brand: 0, range: 1, name: 2, type: 3, color: 4, stock: -1, notes: -1 };
  if (hasHeader) {
    for (const key of Object.keys(col) as (keyof Columns)[]) col[key] = header.indexOf(key);
  } else if (rows[0]!.length === 1) {
    // A plain list of names, one per line.
    Object.assign(col, { brand: -1, range: -1, name: 0, type: -1, color: -1 });
  }

  const items: PaintInput[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  rows.slice(hasHeader ? 1 : 0).forEach((row, index) => {
    const cell = (i: number) => (i >= 0 ? (row[i] ?? '').trim() : '');
    const line = index + (hasHeader ? 2 : 1);
    const brand = cell(col.brand) || fallbackBrand.trim();
    const name = cell(col.name);
    if (!name) return problems.push(`Line ${line}: no paint name`);
    if (!brand) return problems.push(`Line ${line}: no brand for "${name}" (set a default brand above)`);
    const key = `${brand}|${cell(col.range)}|${name}`.toLowerCase();
    if (seen.has(key)) return problems.push(`Line ${line}: "${name}" appears twice`);
    seen.add(key);

    const rawColor = cell(col.color).replace(/^#?/, '#').toLowerCase();
    const rawStock = cell(col.stock).toLowerCase();
    items.push({
      brand,
      range: cell(col.range),
      name,
      type: cell(col.type) || undefined,
      colorHex: /^#[0-9a-f]{6}$/.test(rawColor) ? rawColor : undefined,
      stock: (PAINT_STOCKS as readonly string[]).includes(rawStock) ? (rawStock as PaintStock) : STOCK_WORDS[rawStock],
      notes: cell(col.notes) || undefined,
    });
  });
  return { items, problems };
}
