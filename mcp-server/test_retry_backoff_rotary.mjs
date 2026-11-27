import assert from 'node:assert/strict';
import { recordRetryBackoff, getAvgRetryBackoff } from './retry_backoff_rotary.mjs';

recordRetryBackoff(100);
recordRetryBackoff(300);
assert.equal(getAvgRetryBackoff(), 200);
console.log('PASS retry_backoff_rotary');
