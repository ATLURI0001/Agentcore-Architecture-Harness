import assert from 'node:assert/strict';
import { EventTraceRotary } from './event_trace_rotary.mjs';

const r = new EventTraceRotary(2);
r.push('e1'); r.push('e2'); r.push('e3');
assert.equal(r.count(), 2);
console.log('PASS event_trace_rotary');
