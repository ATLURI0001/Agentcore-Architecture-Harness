import assert from 'node:assert/strict';
import { recordTokenUsage, getAvgTokenUsage } from './token_usage_rotary.mjs';

recordTokenUsage(100);
recordTokenUsage(300);
assert.equal(getAvgTokenUsage(), 200);
console.log('PASS token_usage_rotary');
