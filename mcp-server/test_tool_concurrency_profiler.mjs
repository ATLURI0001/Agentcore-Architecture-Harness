import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolConcurrencyProfiler } from './tool_concurrency_profiler.mjs';

test('ToolConcurrencyProfiler: basic submission and execution', async () => {
  const profiler = new ToolConcurrencyProfiler({ concurrencyLimit: 4 });

  const result = await profiler.submit('test_tool', async () => {
    return 'tool_output';
  });

  assert.equal(result, 'tool_output');
  assert.equal(profiler.completedCount, 1);
  assert.equal(profiler.latenciesMs.length, 1);
  assert.equal(profiler.queueWaitTimesMs.length, 1);
});

test('ToolConcurrencyProfiler: input validation guards', async () => {
  const profiler = new ToolConcurrencyProfiler();

  await assert.rejects(
    async () => {
      await profiler.submit('invalid_tool', 'not_a_function');
    },
    { name: 'TypeError', message: /taskFn must be a callable function/ }
  );
});

test('ToolConcurrencyProfiler: concurrency ceiling enforcement', async () => {
  const profiler = new ToolConcurrencyProfiler({ concurrencyLimit: 2 });
  let currentActive = 0;
  let maxObservedActive = 0;

  const tasks = [];
  for (let i = 0; i < 6; i++) {
    tasks.push(
      profiler.submit('worker', async () => {
        currentActive++;
        if (currentActive > maxObservedActive) {
          maxObservedActive = currentActive;
        }
        await new Promise((r) => setTimeout(r, 10));
        currentActive--;
        return i;
      })
    );
  }

  const results = await Promise.all(tasks);
  assert.equal(results.length, 6);
  assert.equal(maxObservedActive <= 2, true);
  assert.equal(profiler.completedCount, 6);
});

test('ToolConcurrencyProfiler: runBenchmark execution and metrics structure', async () => {
  const report = await ToolConcurrencyProfiler.runBenchmark({
    concurrency: 4,
    totalTasks: 20,
    simulatedWorkMs: 2,
  });

  assert.equal(report.totalTasks, 20);
  assert.equal(report.concurrency, 4);
  assert.ok(report.throughputQps > 0);
  assert.ok(report.wallClockDurationMs > 0);
  assert.ok(report.latency.meanMs >= 0);
  assert.ok(report.latency.p90Ms >= 0);
  assert.ok(report.queueWait.meanMs >= 0);
});
