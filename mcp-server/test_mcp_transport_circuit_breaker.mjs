import assert from 'node:assert/strict';
import { recordTransportFailure, isTransportOpen, resetTransport } from './mcp_transport_circuit_breaker.mjs';

resetTransport();
recordTransportFailure(2);
recordTransportFailure(2);
assert.equal(isTransportOpen(), true);
console.log('PASS mcp_transport_circuit_breaker');
