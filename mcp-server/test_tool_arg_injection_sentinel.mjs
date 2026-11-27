import assert from 'node:assert/strict';
import { assertSafeToolArg } from './tool_arg_injection_sentinel.mjs';

assertSafeToolArg('safe_filename.txt');
assert.throws(() => assertSafeToolArg('foo; rm -rf /'));
console.log('PASS tool_arg_injection_sentinel');
