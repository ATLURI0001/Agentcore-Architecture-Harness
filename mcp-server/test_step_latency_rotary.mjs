import assert from 'node:assert/strict';
import { recordStepLatency, getStepLatencyAvg } from './step_latency_rotary.mjs';

recordStepLatency(10);
recordStepLatency(30);
assert.equal(getStepLatencyAvg(), 20);
console.log('PASS step_latency_rotary');
