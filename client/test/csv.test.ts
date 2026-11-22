import assert from 'node:assert/strict';
import { test } from 'node:test';
import { csvToPaints, parseCsv } from '../src/lib/csv.ts';

test('parseCsv handles quotes, doubled quotes, newlines inside quotes and CRLF', () => {
  assert.deepEqual(parseCsv('a,"b, c","say ""hi"""\r\n1,"two\nlines",3\n', ','), [
    ['a', 'b, c', 'say "hi"'],
    ['1', 'two\nlines', '3'],
  ]);
  assert.deepEqual(parseCsv('\n\na;b\n\n', ';'), [['a', 'b']], 'blank lines are dropped');
});

test('header row in any order, Italian names, semicolons and a BOM', () => {
  const { items, problems } = csvToPaints('﻿Nome;Marca;Colore;Stato;Gamma\nMacragge Blue;Citadel;0D407F;sta finendo;Base\n', '');
  assert.deepEqual(problems, []);
  assert.deepEqual(items, [{ brand: 'Citadel', range: 'Base', name: 'Macragge Blue', type: undefined, colorHex: '#0d407f', stock: 'low', notes: undefined }]);
});

test('without a header, columns are brand, range, name, type, colour', () => {
  const { items } = csvToPaints('Citadel,Shade,Nuln Oil,Shade,#14100e', '');
  assert.equal(items[0]!.name, 'Nuln Oil');
  assert.equal(items[0]!.type, 'Shade');
  assert.equal(items[0]!.colorHex, '#14100e');
});

test('a plain list of names takes the default brand', () => {
  const { items, problems } = csvToPaints('Abaddon Black\nNuln Oil\n', 'Citadel');
  assert.deepEqual(problems, []);
  assert.deepEqual(items.map((i) => `${i.brand}/${i.name}`), ['Citadel/Abaddon Black', 'Citadel/Nuln Oil']);
});

test('rows without a name or brand, and duplicates, are reported and skipped', () => {
  const { items, problems } = csvToPaints('brand,range,name\nCitadel,Base,Mephiston Red\n,Base,No Brand\nCitadel,Base,\ncitadel,base,mephiston red\n', '');
  assert.equal(items.length, 1);
  assert.deepEqual(problems, [
    'Line 3: no brand for "No Brand" (set a default brand above)',
    'Line 4: no paint name',
    'Line 5: "mephiston red" appears twice',
  ]);
});

test('unknown stock words and invalid colours are ignored rather than guessed', () => {
  const { items } = csvToPaints('brand,name,color,stock\nX,Y,not-a-colour,maybe\nX,Z,#ABCDEF,wishlist\n', '');
  assert.equal(items[0]!.colorHex, undefined);
  assert.equal(items[0]!.stock, undefined);
  assert.equal(items[1]!.colorHex, '#abcdef');
  assert.equal(items[1]!.stock, 'wanted');
});

test('tab-separated text pasted from a spreadsheet', () => {
  const { items } = csvToPaints('brand\tname\nVallejo\tBonewhite\n', '');
  assert.equal(items[0]!.brand, 'Vallejo');
  assert.equal(items[0]!.name, 'Bonewhite');
});
