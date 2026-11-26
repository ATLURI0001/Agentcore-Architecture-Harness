import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConsensusTelemetryRotary } from './consensus_telemetry_rotary.mjs';

describe('ConsensusTelemetryRotary Suite', () => {
  it('records nominal consensus round with dissent ratio', () => {
    const rotary = new ConsensusTelemetryRotary(50, 40.0);
    const sample = rotary.recordRound({
      roundId: 'rnd-101',
      proposerAgentId: 'agent-primary',
      voterCount: 5,
      consensusReached: true,
      durationMs: 18.5,
      dissentCount: 1,
      roundsToConverge: 1,
      timestamp: 1000,
    });

    assert.equal(sample.roundId, 'rnd-101');
    assert.equal(sample.proposerAgentId, 'agent-primary');
    assert.equal(sample.voterCount, 5);
    assert.equal(sample.dissentRatio, 0.2); // 1/5
    assert.equal(sample.isBreach, false);

    const stats = rotary.getStats();
    assert.equal(stats.totalIngested, 1);
    assert.equal(stats.activeSamples, 1);
  });

  it('detects latency breach threshold', () => {
    const rotary = new ConsensusTelemetryRotary(50, 30.0);
    const sample = rotary.recordRound({
      roundId: 'rnd-sluggish',
      proposerAgentId: 'agent-slow',
      voterCount: 3,
      consensusReached: true,
      durationMs: 45.2,
      dissentCount: 0,
    });

    assert.equal(sample.isBreach, true);
  });

  it('enforces circular rollover without memory growth', () => {
    const capacity = 10;
    const rotary = new ConsensusTelemetryRotary(capacity, 50.0);

    for (let i = 0; i < 25; i++) {
      rotary.recordRound({
        roundId: `rnd-${i}`,
        proposerAgentId: 'agent-loop',
        voterCount: 4,
        consensusReached: true,
        durationMs: 10.0 + i,
      });
    }

    assert.equal(rotary.getStats().totalIngested, 25);
    assert.equal(rotary.getStats().activeSamples, capacity);
    assert.equal(rotary.getActiveSamples().length, capacity);
  });

  it('filters samples within rolling time window', () => {
    const rotary = new ConsensusTelemetryRotary(50, 50.0);
    const now = 100000;

    rotary.recordRound({ roundId: 'r1', proposerAgentId: 'a1', voterCount: 3, consensusReached: true, durationMs: 10, timestamp: now - 50000 });
    rotary.recordRound({ roundId: 'r2', proposerAgentId: 'a1', voterCount: 3, consensusReached: true, durationMs: 15, timestamp: now - 15000 });
    rotary.recordRound({ roundId: 'r3', proposerAgentId: 'a1', voterCount: 3, consensusReached: true, durationMs: 20, timestamp: now - 5000 });

    const recent = rotary.getWindowSamples(20000, now);
    assert.equal(recent.length, 2);
  });

  it('computes accurate percentiles, success rate, and dissent average', () => {
    const rotary = new ConsensusTelemetryRotary(50, 35.0);

    for (let i = 1; i <= 10; i++) {
      rotary.recordRound({
        roundId: `round-${i}`,
        proposerAgentId: 'agent-target',
        voterCount: 10,
        consensusReached: i > 2, // 8 reached, 2 failed
        durationMs: i * 5, // 5 to 50ms
        dissentCount: i % 3,
      });
    }

    const summary = rotary.summarize('agent-target');
    assert.equal(summary.sampleCount, 10);
    assert.equal(summary.consensusSuccessRate, 0.8);
    assert.equal(summary.percentiles.min, 5);
    assert.equal(summary.percentiles.max, 50);
    assert.equal(summary.percentiles.p50, 30);
    assert.equal(summary.breachCount, 4); // 35, 40, 45, 50 >= 35
  });

  it('defensively validates input parameters', () => {
    const rotary = new ConsensusTelemetryRotary(50, 50.0);

    assert.throws(
      () => rotary.recordRound({ roundId: '', proposerAgentId: 'a', voterCount: 2, durationMs: 10 }),
      /roundId must be a non-empty string/
    );

    assert.throws(
      () => rotary.recordRound({ roundId: 'r', proposerAgentId: 'a', voterCount: 2, durationMs: -5 }),
      /durationMs cannot be negative/
    );

    assert.throws(
      () => rotary.recordRound({ roundId: 'r', proposerAgentId: 'a', voterCount: 2, durationMs: 10, dissentCount: 5 }),
      /dissentCount must be between 0 and voterCount/
    );

    assert.throws(() => new ConsensusTelemetryRotary(5), /Capacity must be at least 10/);
  });

  it('resets cleanly', () => {
    const rotary = new ConsensusTelemetryRotary(50, 50.0);
    rotary.recordRound({ roundId: 'r1', proposerAgentId: 'a', voterCount: 2, durationMs: 10 });
    assert.equal(rotary.getActiveSamples().length, 1);

    rotary.reset();
    assert.equal(rotary.getActiveSamples().length, 0);
    assert.equal(rotary.getStats().totalIngested, 0);
  });
});
