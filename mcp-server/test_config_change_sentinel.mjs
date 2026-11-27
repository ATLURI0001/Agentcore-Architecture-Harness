import assert from 'node:assert/strict';
import { validateConfigChange } from './config_change_sentinel.mjs';

try {
  validateConfigChange({ key: 'timeout', value: 30 });
  let threw = false;
  try { validateConfigChange({ key: 123 }); } catch { threw = true; }
  assert.ok(threw, 'expected error for non-string key');
  console.log('PASS config_change_sentinel');
} catch (e) {
  console.error('FAIL', e.message);
  process.exit(1);
}
