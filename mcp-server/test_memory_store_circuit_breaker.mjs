import assert from 'node:assert/strict';
import { MemoryStoreCircuitBreaker } from './memory_store_circuit_breaker.mjs';

const cb = new MemoryStoreCircuitBreaker(2, 5000);
assert.throws(() => cb.call(() => { throw new Error('store err'); }));
assert.throws(() => cb.call(() => { throw new Error('store err'); }));
assert.throws(() => cb.call(() => 'ok'), /circuit open/);
console.log('PASS memory_store_circuit_breaker');
