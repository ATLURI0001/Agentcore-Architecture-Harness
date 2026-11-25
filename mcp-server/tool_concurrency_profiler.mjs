/**
 * @file tool_concurrency_profiler.mjs
 * High-concurrency MCP tool execution profiler and latency benchmark harness.
 */

import { performance } from 'node:perf_hooks';

export class ToolConcurrencyProfiler {
  constructor(options = {}) {
    this.concurrencyLimit = Math.max(1, Number(options.concurrencyLimit) || 16);
    this.queue = [];
    this.activeWorkers = 0;
    this.completedCount = 0;
    this.totalExecutionTimeMs = 0;
    this.latenciesMs = [];
    this.queueWaitTimesMs = [];
  }

  /**
   * Submits a tool execution task to the concurrency harness.
   * @param {string} toolName
   * @param {Function} taskFn - Async function executing the tool
   * @returns {Promise<any>}
   */
  async submit(toolName, taskFn) {
    if (typeof taskFn !== 'function') {
      throw new TypeError('taskFn must be a callable function');
    }

    const enqueueTime = performance.now();

    return new Promise((resolve, reject) => {
      this.queue.push({
        toolName: String(toolName || 'anonymous'),
        taskFn,
        enqueueTime,
        resolve,
        reject,
      });

      this._drain();
    });
  }

  async _drain() {
    if (this.activeWorkers >= this.concurrencyLimit || this.queue.length === 0) {
      return;
    }

    this.activeWorkers++;
    const item = this.queue.shift();
    const waitTime = performance.now() - item.enqueueTime;
    this.queueWaitTimesMs.push(waitTime);

    const execStart = performance.now();
    try {
      const result = await item.taskFn();
      const execDuration = performance.now() - execStart;
      this.latenciesMs.push(execDuration);
      this.totalExecutionTimeMs += execDuration;
      this.completedCount++;
      item.resolve(result);
    } catch (err) {
      const execDuration = performance.now() - execStart;
      this.latenciesMs.push(execDuration);
      this.totalExecutionTimeMs += execDuration;
      this.completedCount++;
      item.reject(err);
    } finally {
      this.activeWorkers--;
      this._drain();
    }
  }

  /**
   * Waits for all queued and active tasks to drain.
   */
  async drainAll() {
    while (this.activeWorkers > 0 || this.queue.length > 0) {
      await new Promise((r) => setTimeout(r, 2));
    }
  }

  /**
   * Runs a structured benchmark under simulated concurrent load.
   */
  static async runBenchmark(options = {}) {
    const concurrency = Math.max(1, Number(options.concurrency) || 8);
    const totalTasks = Math.max(1, Number(options.totalTasks) || 100);
    const simulatedWorkMs = Math.max(0, Number(options.simulatedWorkMs) || 1);

    const profiler = new ToolConcurrencyProfiler({ concurrencyLimit: concurrency });

    // Warmup cycle
    for (let i = 0; i < 10; i++) {
      await profiler.submit('warmup_tool', async () => {
        return Math.sqrt(i * 100);
      });
    }
    await profiler.drainAll();

    // Reset metrics after warmup
    profiler.latenciesMs = [];
    profiler.queueWaitTimesMs = [];
    profiler.completedCount = 0;
    profiler.totalExecutionTimeMs = 0;

    const wallClockStart = performance.now();

    const tasks = [];
    for (let i = 0; i < totalTasks; i++) {
      tasks.push(
        profiler.submit(`tool_${i % 4}`, async () => {
          if (simulatedWorkMs > 0) {
            await new Promise((r) => setTimeout(r, simulatedWorkMs));
          }
          return { taskId: i, status: 'ok' };
        })
      );
    }

    await Promise.all(tasks);
    await profiler.drainAll();

    const wallClockDurationMs = performance.now() - wallClockStart;

    const sortedLatencies = [...profiler.latenciesMs].sort((a, b) => a - b);
    const sortedWaitTimes = [...profiler.queueWaitTimesMs].sort((a, b) => a - b);

    const getP = (arr, pct) => {
      if (arr.length === 0) return 0;
      const idx = Math.min(arr.length - 1, Math.max(0, Math.ceil(pct * arr.length) - 1));
      return arr[idx];
    };

    const meanLatency =
      sortedLatencies.reduce((acc, v) => acc + v, 0) / (sortedLatencies.length || 1);
    const meanWait =
      sortedWaitTimes.reduce((acc, v) => acc + v, 0) / (sortedWaitTimes.length || 1);

    const qps = (totalTasks / (wallClockDurationMs / 1000));

    return {
      totalTasks,
      concurrency,
      wallClockDurationMs,
      throughputQps: Number(qps.toFixed(2)),
      latency: {
        p50Ms: Number(getP(sortedLatencies, 0.5).toFixed(3)),
        p90Ms: Number(getP(sortedLatencies, 0.9).toFixed(3)),
        p99Ms: Number(getP(sortedLatencies, 0.99).toFixed(3)),
        meanMs: Number(meanLatency.toFixed(3)),
        minMs: Number((sortedLatencies[0] || 0).toFixed(3)),
        maxMs: Number((sortedLatencies[sortedLatencies.length - 1] || 0).toFixed(3)),
      },
      queueWait: {
        p50Ms: Number(getP(sortedWaitTimes, 0.5).toFixed(3)),
        p90Ms: Number(getP(sortedWaitTimes, 0.9).toFixed(3)),
        meanMs: Number(meanWait.toFixed(3)),
        maxMs: Number((sortedWaitTimes[sortedWaitTimes.length - 1] || 0).toFixed(3)),
      },
    };
  }
}
