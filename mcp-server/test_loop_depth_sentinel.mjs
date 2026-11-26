import assert from 'node:assert/strict';
import { assertLoopDepthWithinLimit } from './loop_depth_sentinel.mjs';

assertLoopDepthWithinLimit(4, 16);
assert.throws(() => assertLoopDepthWithinLimit(20, 16));
console.log('PASS loop_depth_sentinel');
