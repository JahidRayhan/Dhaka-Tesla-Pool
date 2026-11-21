import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTaka, timeLeftLabel, STATUS_LABEL, STATUS_TONE } from '../lib/format.js';

test('formatTaka shows paisa as taka with two decimals, and a dash for missing values', () => {
  assert.equal(formatTaka(20566), '৳205.66');
  assert.equal(formatTaka('10283'), '৳102.83');
  assert.equal(formatTaka(0), '৳0.00');
  assert.equal(formatTaka(null), '—');
  assert.equal(formatTaka(undefined), '—');
});

test('timeLeftLabel rounds up, handles no deadline, and says when time is up', () => {
  const now = Date.parse('2026-10-04T10:00:00Z');
  assert.equal(timeLeftLabel(null, now), null);
  assert.equal(timeLeftLabel('2026-10-04T10:05:00Z', now), '5 min left');
  assert.equal(timeLeftLabel('2026-10-04T10:00:01Z', now), '1 min left');
  assert.equal(timeLeftLabel('2026-10-04T09:59:59Z', now), 'expiring now');
});

test('every status has a label and a tone', () => {
  for (const status of ['REQUESTED', 'PENDING_CONFIRMATION', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED']) {
    assert.ok(STATUS_LABEL[status], status);
    assert.ok(STATUS_TONE[status], status);
  }
});
