// test_agentcore_perf_profiler.mjs
import assert from 'node:assert/strict';
import { AgentcorePerfProfiler } from './agentcore_perf_profiler.mjs';

const p = new AgentcorePerfProfiler();
p.record('op', () => { let x = 0; for (let i = 0; i < 1000; i++) x += i; return x; });
assert.ok(p.maxMs() >= 0, 'maxMs should be non-negative');
console.log('PASS agentcore_perf_profiler');
