/**
 * Tool Schema Lookup & Memoized JSON Validator Benchmark Profiler.
 */
export class ToolSchemaCacheProfiler {
  constructor() {
    this.cache = new Map();
  }

  registerSchema(name, validatorFn) {
    this.cache.set(name, validatorFn);
  }

  runBenchmark(name, iterations = 1000) {
    const fn = this.cache.get(name);
    if (!fn) throw new Error(`Missing schema: ${name}`);

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      fn({ ok: true, idx: i });
    }
    const elapsedMicros = Math.max(1, (performance.now() - start) * 1000);
    return {
      iterations,
      elapsedMicros: Number(elapsedMicros.toFixed(2)),
      throughputOpsSec: Math.round((iterations / elapsedMicros) * 1_000_000),
    };
  }
}
