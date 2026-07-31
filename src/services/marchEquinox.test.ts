import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateMarchEquinoxes } from './marchEquinox.js';

test('calculates March equinoxes from tropical solar longitude', () => {
  const result = calculateMarchEquinoxes({ startYear: 2026, endYear: 2029 });

  assert.equal(result.events.length, 4);
  assert.equal(result.events[0]?.exactUTC, '2026-03-20T14:45:58Z');
  assert.equal(result.events[1]?.exactUTC, '2027-03-20T20:24:43Z');
  assert.equal(result.events[2]?.exactUTC, '2028-03-20T02:17:10Z');
  assert.equal(result.events[3]?.exactUTC, '2029-03-20T08:01:59Z');

  for (const event of result.events) {
    assert.ok(event.sunLongitude < 0.001 || event.sunLongitude > 359.999);
  }
});
