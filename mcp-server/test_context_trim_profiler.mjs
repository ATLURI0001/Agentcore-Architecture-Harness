import assert from 'node:assert/strict';
import { benchmarkContextTrim } from './context_trim_profiler.mjs';

const res = benchmarkContextTrim(Array.from({ length: 20 }, (_, i) => i), 10, 100);
assert.ok(res.opsPerSec > 0);
console.log('PASS context_trim_profiler');
