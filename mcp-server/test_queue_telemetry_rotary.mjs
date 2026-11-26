import assert from 'node:assert/strict';
import { QueueTelemetryRotary } from './queue_telemetry_rotary.mjs';

function runTests() {
  console.log('Running QueueTelemetryRotary tests...');

  // Test 1: Empty state
  {
    const rotary = new QueueTelemetryRotary(10, 8);
    const summary = rotary.getSummary();
    assert.equal(summary.sampleCount, 0);
    assert.equal(summary.totalRecorded, 0);
    assert.equal(summary.poolSaturationRatio, 0);
    assert.equal(summary.maxQueueDepth, 0);
  }

  // Test 2: Recording and recent chronological ordering
  {
    const rotary = new QueueTelemetryRotary(5, 10);
    for (let i = 1; i <= 3; i++) {
      rotary.record({
        toolName: `tool_${i}`,
        queueDepth: i,
        activeWorkers: i * 2,
        pendingLagMs: i * 10,
        executionDurationMs: i * 50,
      });
    }

    const recent = rotary.getRecent();
    assert.equal(recent.length, 3);
    assert.equal(recent[0].toolName, 'tool_1');
    assert.equal(recent[2].toolName, 'tool_3');
  }

  // Test 3: Circular buffer wrap-around
  {
    const rotary = new QueueTelemetryRotary(3, 10);
    for (let i = 1; i <= 5; i++) {
      rotary.record({
        toolName: `tool_${i}`,
        queueDepth: i,
        activeWorkers: 4,
        pendingLagMs: 20,
        executionDurationMs: 100,
      });
    }

    assert.equal(rotary.count, 3);
    assert.equal(rotary.totalRecorded, 5);
    const recent = rotary.getRecent();
    assert.equal(recent.length, 3);
    assert.equal(recent[0].toolName, 'tool_3');
    assert.equal(recent[1].toolName, 'tool_4');
    assert.equal(recent[2].toolName, 'tool_5');
  }

  // Test 4: Quantiles and summary calculations
  {
    const rotary = new QueueTelemetryRotary(100, 10);
    // Add 10 observations with increasing lag: 10, 20, 30 ... 100
    for (let i = 1; i <= 10; i++) {
      rotary.record({
        toolName: 'exec_cmd',
        queueDepth: i > 8 ? 5 : 1,
        activeWorkers: 5,
        pendingLagMs: i * 10,
        executionDurationMs: i * 20,
        success: i !== 10, // 1 failure out of 10
      });
    }

    const summary = rotary.getSummary();
    assert.equal(summary.sampleCount, 10);
    assert.equal(summary.maxQueueDepth, 5);
    assert.equal(summary.maxLagMs, 100);
    assert.equal(summary.poolSaturationRatio, 0.5); // 5 / 10
    assert.equal(summary.errorRatePercent, 10.0);
    assert.ok(summary.lagQuantiles.p50 >= 50);
    assert.ok(summary.lagQuantiles.p90 >= 90);
  }

  // Test 5: Reset
  {
    const rotary = new QueueTelemetryRotary(10, 4);
    rotary.record({
      toolName: 'read_file',
      queueDepth: 2,
      activeWorkers: 1,
      pendingLagMs: 5,
      executionDurationMs: 15,
    });
    assert.equal(rotary.count, 1);
    rotary.reset();
    assert.equal(rotary.count, 0);
    assert.equal(rotary.totalRecorded, 0);
  }

  console.log('All QueueTelemetryRotary tests passed successfully!');
}

runTests();
