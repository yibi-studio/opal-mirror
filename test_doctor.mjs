import assert from 'node:assert/strict';
import { parseEvalValue } from './lib/doctor_eval.mjs';

const cases = [
  ['string payload', '{"ok":true,"user":"a@example.com"}', { ok: true, user: 'a@example.com' }],
  ['object payload', { ok: true, user: 'a@example.com' }, { ok: true, user: 'a@example.com' }],
];

let passed = 0;
for (const [name, input, expected] of cases) {
  assert.deepEqual(parseEvalValue(input), expected);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

assert.throws(() => parseEvalValue(null), /unexpected eval value/);
passed += 1;
console.log('  ✓ invalid payload rejected');

console.log(`\n=== DOCTOR TEST SUMMARY ===`);
console.log(`${passed} passed / 0 failed`);
