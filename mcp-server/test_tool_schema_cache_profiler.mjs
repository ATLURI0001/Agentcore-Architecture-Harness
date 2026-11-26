import assert from 'node:assert/strict';
import { ToolSchemaCacheProfiler } from './tool_schema_cache_profiler.mjs';

const profiler = new ToolSchemaCacheProfiler();
profiler.registerSchema('ping', (obj) => Boolean(obj.ok));

const res = profiler.runBenchmark('ping', 500);
assert.equal(res.iterations, 500);
assert.ok(res.throughputOpsSec > 0);
console.log('ToolSchemaCacheProfiler tests passed!');
