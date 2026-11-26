/**
 * Agent Consensus Latency & Voting Disparity Telemetry Rotary for Agentcore.
 *
 * Implements a high-throughput circular rotary buffer tracking multi-agent consensus
 * round durations, vote dissent ratios, convergence iteration cycles, and latency percentiles.
 */

export class ConsensusTelemetryRotary {
  constructor(capacity = 250, breachThresholdMs = 50.0) {
    if (capacity < 10) {
      throw new Error(`Capacity must be at least 10, got ${capacity}`);
    }
    if (breachThresholdMs <= 0) {
      throw new Error(`breachThresholdMs must be positive, got ${breachThresholdMs}`);
    }

    this.capacity = capacity;
    this.breachThresholdMs = breachThresholdMs;
    this.buffer = new Array(capacity).fill(null);
    this.headIndex = 0;
    this.totalIngested = 0;
  }

  /**
   * Record a completed consensus round into the rotary buffer.
   */
  recordRound({
    roundId,
    proposerAgentId,
    voterCount,
    consensusReached,
    durationMs,
    dissentCount = 0,
    roundsToConverge = 1,
    timestamp = Date.now(),
  }) {
    if (!roundId || typeof roundId !== 'string') {
      throw new Error(`roundId must be a non-empty string, got: ${roundId}`);
    }
    if (!proposerAgentId || typeof proposerAgentId !== 'string') {
      throw new Error(`proposerAgentId must be a non-empty string, got: ${proposerAgentId}`);
    }
    if (typeof voterCount !== 'number' || voterCount < 1) {
      throw new Error(`voterCount must be >= 1, got: ${voterCount}`);
    }
    if (typeof durationMs !== 'number' || durationMs < 0) {
      throw new Error(`durationMs cannot be negative, got: ${durationMs}`);
    }
    if (dissentCount < 0 || dissentCount > voterCount) {
      throw new Error(`dissentCount must be between 0 and voterCount (${voterCount}), got: ${dissentCount}`);
    }

    const dissentRatio = Math.round((dissentCount / voterCount) * 1000) / 1000;
    const isBreach = durationMs >= this.breachThresholdMs;

    const sample = {
      roundId,
      proposerAgentId,
      voterCount,
      consensusReached: Boolean(consensusReached),
      durationMs: Math.round(durationMs * 100) / 100,
      dissentCount,
      dissentRatio,
      roundsToConverge,
      isBreach,
      timestamp,
    };

    this.buffer[this.headIndex] = sample;
    this.headIndex = (this.headIndex + 1) % this.capacity;
    this.totalIngested++;

    return sample;
  }

  /**
   * Return all valid active samples currently residing in the rotary buffer.
   */
  getActiveSamples() {
    const count = Math.min(this.totalIngested, this.capacity);
    const active = [];
    for (let i = 0; i < count; i++) {
      if (this.buffer[i] !== null) {
        active.push(this.buffer[i]);
      }
    }
    return active;
  }

  /**
   * Return samples matching a rolling window duration (in ms) relative to referenceTime.
   */
  getWindowSamples(windowMs, referenceTime = Date.now()) {
    const cutoff = referenceTime - windowMs;
    return this.getActiveSamples().filter((s) => s.timestamp >= cutoff);
  }

  /**
   * Compute latency percentiles (p50, p90, p99, min, max, avg).
   */
  computePercentiles(samples) {
    if (samples.length === 0) {
      return { p50: 0, p90: 0, p99: 0, min: 0, max: 0, avg: 0 };
    }

    const sorted = samples.map((s) => s.durationMs).sort((a, b) => a - b);
    const n = sorted.length;

    const getP = (p) => {
      const idx = Math.min(Math.floor((p / 100) * n), n - 1);
      return sorted[idx];
    };

    const sum = sorted.reduce((acc, v) => acc + v, 0);

    return {
      p50: getP(50),
      p90: getP(90),
      p99: getP(99),
      min: sorted[0],
      max: sorted[n - 1],
      avg: Math.round((sum / n) * 100) / 100,
    };
  }

  /**
   * Summarize consensus performance metrics.
   */
  summarize(agentId) {
    let samples = this.getActiveSamples();
    const targetAgent = agentId || 'all-agents';
    if (agentId) {
      samples = samples.filter((s) => s.proposerAgentId === agentId);
    }

    if (samples.length === 0) {
      return {
        targetAgent,
        sampleCount: 0,
        consensusSuccessRate: 1.0,
        avgDissentRatio: 0,
        percentiles: { p50: 0, p90: 0, p99: 0, min: 0, max: 0, avg: 0 },
        breachCount: 0,
      };
    }

    const percentiles = this.computePercentiles(samples);
    const reachedCount = samples.filter((s) => s.consensusReached).length;
    const totalDissent = samples.reduce((acc, s) => acc + s.dissentRatio, 0);
    const breaches = samples.filter((s) => s.isBreach).length;

    return {
      targetAgent,
      sampleCount: samples.length,
      consensusSuccessRate: Math.round((reachedCount / samples.length) * 1000) / 1000,
      avgDissentRatio: Math.round((totalDissent / samples.length) * 1000) / 1000,
      percentiles,
      breachCount: breaches,
    };
  }

  /**
   * Reset rotary buffer state.
   */
  reset() {
    this.buffer.fill(null);
    this.headIndex = 0;
    this.totalIngested = 0;
  }

  getStats() {
    return {
      capacity: this.capacity,
      totalIngested: this.totalIngested,
      activeSamples: Math.min(this.totalIngested, this.capacity),
      breachThresholdMs: this.breachThresholdMs,
    };
  }
}
