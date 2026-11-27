import assert from 'node:assert/strict';
import { validateEvent } from './event_dispatch_sentinel.mjs';

try {
  validateEvent({ type: 'task.created' });
  let threw = false;
  try { validateEvent({ type: '' }); } catch { threw = true; }
  assert.ok(threw, 'expected error for empty type');
  console.log('PASS event_dispatch_sentinel');
} catch (e) {
  console.error('FAIL', e.message);
  process.exit(1);
}
