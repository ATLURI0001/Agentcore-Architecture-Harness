import assert from 'node:assert/strict';
import { profileMemory } from './memory_footprint_profiler.mjs';

try {
  const result = profileMemory('test', () => { const a = new Array(100).fill(0); void a; });
  assert.equal(result.label, 'test');
  assert.ok(typeof result.deltaBytes === 'number');
  console.log('PASS memory_footprint_profiler');
} catch (e) {
  console.error('FAIL', e.message);
  process.exit(1);
}
