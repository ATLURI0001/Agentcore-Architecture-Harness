import assert from 'node:assert/strict';
import { ContextBloatSentinel } from './context_bloat_sentinel.mjs';

const sentinel = new ContextBloatSentinel(10000, 3000);

// Normal turn
const r1 = sentinel.inspectTurn('t1', 2000);
assert.equal(r1.allowed, true);
assert.equal(r1.currentTokens, 2000);

// Single turn bloat
const r2 = sentinel.inspectTurn('t2', 5000);
assert.equal(r2.allowed, false);
assert.equal(r2.reason, 'ERR_SINGLE_TURN_BLOAT');

// Window overflow
sentinel.inspectTurn('t3', 3000);
sentinel.inspectTurn('t4', 3000);
const r5 = sentinel.inspectTurn('t5', 2500); // 8000 + 2500 = 10500 > 10000
assert.equal(r5.allowed, false);
assert.equal(r5.reason, 'ERR_CONTEXT_WINDOW_OVERFLOW');

console.log('ContextBloatSentinel tests passed!');
