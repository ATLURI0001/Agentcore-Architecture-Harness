// agentcore_perf_profiler.mjs – perf profiler for agentcore MCP operations
import { performance } from 'node:perf_hooks';

export class AgentcorePerfProfiler {
  #samples = [];

  record(label, fn) {
    const t0 = performance.now();
    const result = fn();
    this.#samples.push({ label, durationMs: performance.now() - t0 });
    return result;
  }

  maxMs() {
    return Math.max(...this.#samples.map(s => s.durationMs));
  }
}
