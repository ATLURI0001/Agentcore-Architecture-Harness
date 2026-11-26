import assert from 'node:assert/strict';
import { benchmarkPromptHash } from './prompt_hash_profiler.mjs';

const res = benchmarkPromptHash('system prompt payload', 100);
assert.ok(res.opsPerSec > 0);
console.log('PASS prompt_hash_profiler');
