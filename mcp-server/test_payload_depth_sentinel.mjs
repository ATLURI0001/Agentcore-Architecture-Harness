import assert from 'node:assert/strict';
import { checkPayloadDepth } from './payload_depth_sentinel.mjs';

assert.equal(checkPayloadDepth(4, 8), true);
assert.equal(checkPayloadDepth(12, 8), false);
console.log('PASS payload_depth_sentinel');
