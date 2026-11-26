import assert from 'node:assert/strict';
import { ToolExecCircuitBreaker } from './tool_exec_circuit_breaker.mjs';

const cb = new ToolExecCircuitBreaker(2, 5000);
assert.throws(() => cb.call(() => { throw new Error('tool fail'); }));
assert.throws(() => cb.call(() => { throw new Error('tool fail'); }));
assert.throws(() => cb.call(() => 'ok'), /circuit open/);
console.log('PASS tool_exec_circuit_breaker');
