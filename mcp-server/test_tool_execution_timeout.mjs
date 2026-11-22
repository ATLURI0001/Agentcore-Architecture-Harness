import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ToolTimeoutManager,
  ToolTimeoutError,
  ToolCircuitOpenError,
} from './tool_execution_timeout.mjs';

test('ToolTimeoutManager: successfully executes within deadline', async () => {
  const manager = new ToolTimeoutManager({ defaultTimeoutMs: 100 });
  const result = await manager.execute('search_db', 'agent_1', async () => {
    return { records: [1, 2, 3] };
  });

  assert.deepEqual(result, { records: [1, 2, 3] });
  const telemetry = manager.getTelemetry();
  assert.equal(telemetry.stats.executedTotal, 1);
  assert.equal(telemetry.stats.completedTotal, 1);
  assert.equal(telemetry.stats.timedOutTotal, 0);
});

test('ToolTimeoutManager: aborts signal and throws ToolTimeoutError on deadline breach', async () => {
  const manager = new ToolTimeoutManager({ defaultTimeoutMs: 50 });
  let signalAborted = false;

  await assert.rejects(
    async () => {
      await manager.execute('fetch_remote', 'agent_1', async (signal) => {
        signal.addEventListener('abort', () => {
          signalAborted = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 200));
        return 'too late';
      });
    },
    (err) => {
      assert.ok(err instanceof ToolTimeoutError);
      assert.equal(err.toolName, 'fetch_remote');
      assert.equal(err.timeoutMs, 50);
      return true;
    }
  );

  assert.equal(signalAborted, true);
  const telemetry = manager.getTelemetry();
  assert.equal(telemetry.stats.timedOutTotal, 1);
});

test('ToolTimeoutManager: trips circuit to OPEN after consecutive timeouts', async () => {
  let mockTime = 1000;
  const manager = new ToolTimeoutManager({
    defaultTimeoutMs: 30,
    maxConsecutiveTimeouts: 2,
    cooldownPeriodMs: 5000,
    clockFn: () => mockTime,
  });

  // Timeout 1
  await assert.rejects(async () => {
    await manager.execute('flakey_tool', 'agent_1', () => new Promise((r) => setTimeout(r, 100)));
  }, ToolTimeoutError);

  let status = manager.getTelemetry().circuits['flakey_tool'];
  assert.equal(status.state, 'CLOSED');
  assert.equal(status.consecutiveTimeouts, 1);

  // Timeout 2 -> trips to OPEN
  await assert.rejects(async () => {
    await manager.execute('flakey_tool', 'agent_1', () => new Promise((r) => setTimeout(r, 100)));
  }, ToolTimeoutError);

  status = manager.getTelemetry().circuits['flakey_tool'];
  assert.equal(status.state, 'OPEN');
  assert.equal(manager.getTelemetry().stats.trippedTotal, 1);

  // Attempting execution while OPEN rejects immediately
  await assert.rejects(async () => {
    await manager.execute('flakey_tool', 'agent_1', async () => 'instant');
  }, ToolCircuitOpenError);

  assert.equal(manager.getTelemetry().stats.rejectedTotal, 1);

  // Advance time past cooldown
  mockTime += 6000;

  // Next execution transitions to HALF_OPEN probe; if successful, resets to CLOSED
  const recovered = await manager.execute('flakey_tool', 'agent_1', async () => 'ok');
  assert.equal(recovered, 'ok');

  status = manager.getTelemetry().circuits['flakey_tool'];
  assert.equal(status.state, 'CLOSED');
  assert.equal(status.consecutiveTimeouts, 0);
});

test('ToolTimeoutManager: resets internal circuits and telemetry cleanly', () => {
  const manager = new ToolTimeoutManager();
  manager.stats.executedTotal = 50;
  manager.reset();

  const telemetry = manager.getTelemetry();
  assert.equal(telemetry.stats.executedTotal, 0);
  assert.deepEqual(telemetry.circuits, {});
});
