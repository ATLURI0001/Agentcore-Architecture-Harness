import assert from 'node:assert/strict';
import { WorkloadTelemetryRotary } from './workload_telemetry.mjs';

console.log('running workload_telemetry unit tests...');

// 1. Initial defaults and bounds
{
  const rotary = new WorkloadTelemetryRotary();
  const snap = rotary.getSnapshot();
  assert.equal(snap.totalTurns, 0);
  assert.equal(snap.meanDurationMs, 0);
  assert.equal(snap.workloadSkew.giniCoefficient, 0);
  assert.equal(snap.workloadSkew.isImbalanced, false);
  console.log('ok   Default initialization and empty snapshot');
}

// 2. Input validation
{
  const rotary = new WorkloadTelemetryRotary();
  assert.throws(() => rotary.recordTurn('', 'worker', 100), TypeError);
  assert.throws(() => rotary.recordTurn('agent-1', 'worker', -50), RangeError);
  console.log('ok   Defensive validation rejects invalid agentId and negative durations');
}

// 3. Recording and percentiles
{
  const rotary = new WorkloadTelemetryRotary({ maxHistory: 100 });
  for (let i = 1; i <= 100; i++) {
    rotary.recordTurn('agent-1', 'coder', i * 10, i % 10 !== 0, 50); // 10ms to 1000ms
  }

  const snap = rotary.getSnapshot();
  assert.equal(snap.totalTurns, 100);
  assert.equal(snap.successRate, 0.9); // 90% success
  assert.ok(snap.p50DurationMs >= 490 && snap.p50DurationMs <= 520);
  assert.ok(snap.p90DurationMs >= 890 && snap.p90DurationMs <= 910);
  assert.equal(snap.agentBreakdown['agent-1'].turnCount, 100);
  console.log('ok   Percentiles and agent breakdown computed correctly');
}

// 4. Latency anomaly detection
{
  const rotary = new WorkloadTelemetryRotary();
  // Baseline: 10 turns around 100ms
  for (let i = 0; i < 10; i++) {
    rotary.recordTurn('agent-fast', 'worker', 100 + (i % 3) * 5);
  }

  // Normal turn (105ms) -> no anomaly
  const normal = rotary.detectLatencyAnomaly('agent-fast', 105);
  assert.equal(normal.isAnomaly, false);

  // Extreme spike (500ms) -> anomaly flagged
  const spike = rotary.detectLatencyAnomaly('agent-fast', 500);
  assert.equal(spike.isAnomaly, true);
  assert.ok(spike.zScore > 2.5);
  console.log('ok   Latency anomaly detection triggers on statistical spikes');
}

// 5. Workload skew (Gini coefficient)
{
  const balanced = new WorkloadTelemetryRotary();
  balanced.recordTurn('a1', 'worker', 50);
  balanced.recordTurn('a2', 'worker', 50);
  balanced.recordTurn('a3', 'worker', 50);
  const balSkew = balanced.computeWorkloadSkew();
  assert.equal(balSkew.giniCoefficient, 0);
  assert.equal(balSkew.isImbalanced, false);

  const skewed = new WorkloadTelemetryRotary();
  for (let i = 0; i < 100; i++) skewed.recordTurn('bottleneck', 'worker', 50);
  skewed.recordTurn('idle-1', 'worker', 50);
  skewed.recordTurn('idle-2', 'worker', 50);
  const skewRes = skewed.computeWorkloadSkew();
  assert.ok(skewRes.giniCoefficient > 0.4);
  assert.equal(skewRes.isImbalanced, true);
  console.log('ok   Workload skew identifies balanced vs heavily bottlenecked distribution');
}

// 6. Prometheus export
{
  const rotary = new WorkloadTelemetryRotary();
  rotary.recordTurn('agent-alpha', 'planner', 250, true, 120);
  const prom = rotary.exportPrometheus();
  assert.ok(prom.includes('agentcore_turns_total 1'));
  assert.ok(prom.includes('agentcore_success_ratio 1.0000'));
  assert.ok(prom.includes('agentcore_turn_duration_ms{quantile="0.50"} 250'));
  assert.ok(prom.includes('agentcore_agent_turns_total{agent="agent-alpha",role="planner"} 1'));
  console.log('ok   Prometheus metric exposition formatted correctly');
}

console.log('all workload_telemetry unit tests passed successfully!');
