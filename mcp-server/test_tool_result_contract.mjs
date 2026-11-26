import assert from 'node:assert/strict';
import { validateToolResult } from './tool_result_contract.mjs';

assert.equal(validateToolResult({ isError: false, content: [{ type: 'text', text: 'ok' }] }), true);
assert.throws(() => validateToolResult({ isError: 'no', content: [] }));
console.log('PASS tool_result_contract');
