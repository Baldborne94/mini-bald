import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayKey, formatClock, formatDuration, hash, plural, timeAgo } from '../src/lib/format.ts';

test('formatDuration rounds to minutes and switches to hours past 60', () => {
  assert.equal(formatDuration(0), '0m');
  assert.equal(formatDuration(29), '0m');
  assert.equal(formatDuration(31), '1m');
  assert.equal(formatDuration(59 * 60), '59m');
  assert.equal(formatDuration(60 * 60), '1h 00m');
  assert.equal(formatDuration(2 * 3600 + 5 * 60), '2h 05m');
  assert.equal(formatDuration(52 * 3600 + 34 * 60), '52h 34m');
});

test('formatClock shows hours, minutes and seconds and never goes negative', () => {
  assert.equal(formatClock(0), '0:00:00');
  assert.equal(formatClock(3723.9), '1:02:03');
  assert.equal(formatClock(-5), '0:00:00');
});

test('plural picks the right form, with an irregular plural when given', () => {
  assert.equal(plural(1, 'model'), '1 model');
  assert.equal(plural(0, 'model'), '0 models');
  assert.equal(plural(3, 'brush', 'brushes'), '3 brushes');
});

test('timeAgo describes the past in words', () => {
  assert.match(timeAgo(new Date(Date.now() - 5 * 60_000).toISOString()), /5 minutes ago/);
  assert.match(timeAgo(new Date(Date.now() - 3 * 86_400_000).toISOString()), /3 days ago/);
  assert.equal(timeAgo(new Date(Date.now() - 86_400_000).toISOString()), 'yesterday');
});

test('dayKey groups timestamps by local calendar day', () => {
  const morning = new Date(2026, 10, 18, 8, 0).toISOString();
  const evening = new Date(2026, 10, 18, 22, 30).toISOString();
  const next = new Date(2026, 10, 19, 0, 10).toISOString();
  assert.equal(dayKey(morning), dayKey(evening));
  assert.notEqual(dayKey(evening), dayKey(next));
});

test('hash is stable, so placeholder colours do not change between visits', () => {
  assert.equal(hash('12-Intercessors'), hash('12-Intercessors'));
  assert.notEqual(hash('12-Intercessors'), hash('13-Intercessors'));
  assert.ok(hash('x') >= 0);
});
