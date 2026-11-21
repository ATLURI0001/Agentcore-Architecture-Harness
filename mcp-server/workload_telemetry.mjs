/**
 * Multi-Agent Workload Telemetry & Latency Diagnostic Rotary for Agentcore.
 */

export class WorkloadTelemetryRotary {
  constructor(options = {}) {
    this.maxHistory = Number.isInteger(options.maxHistory) && options.maxHistory > 0 ? options.maxHistory : 1000;
    this.anomalyThreshold = typeof options.anomalyThreshold === 'number' && options.anomalyThreshold > 0 ? options.anomalyThreshold : 2.5;

    this.turns = [];
    this.agentStats = new Map();
  }

  recordTurn(agentId, role, durationMs, success = true, tokensUsed = 0) {
    if (!agentId || typeof agentId !== 'string') {
      throw new TypeError('agentId must be a non-empty string');
    }
    const cleanRole = typeof role === 'string' && role.trim() ? role.trim() : 'worker';
    const dur = Number(durationMs);
    if (!Number.isFinite(dur) || dur < 0) {
      throw new RangeError('durationMs must be a non-negative finite number');
    }
    const tokens = Number.isInteger(tokensUsed) && tokensUsed >= 0 ? tokensUsed : 0;

    const entry = {
      agentId,
      role: cleanRole,
      durationMs: dur,
      success: Boolean(success),
      tokensUsed: tokens,
      timestamp: Date.now(),
    };

    this.turns.push(entry);
    if (this.turns.length > this.maxHistory) {
      this.turns.shift();
    }

    if (!this.agentStats.has(agentId)) {
      this.agentStats.set(agentId, {
        agentId,
        role: cleanRole,
        turnCount: 0,
        successCount: 0,
        totalDurationMs: 0,
        totalTokens: 0,
        durations: [],
      });
    }

    const stats = this.agentStats.get(agentId);
    stats.turnCount++;
    if (success) stats.successCount++;
    stats.totalDurationMs += dur;
    stats.totalTokens += tokens;
    stats.durations.push(dur);
    if (stats.durations.length > 200) {
      stats.durations.shift();
    }
  }

  detectLatencyAnomaly(agentId, durationMs) {
    const dur = Number(durationMs);
    const stats = this.agentStats.get(agentId);

    if (!stats || stats.durations.length < 5) {
      return { isAnomaly: false, zScore: 0, mean: 0, stdDev: 0 };
    }

    const arr = stats.durations;
    const mean = arr.reduce((sum, v) => sum + v, 0) / arr.length;
    const variance = arr.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / arr.length;
    const rawStdDev = Math.sqrt(variance);
    const stdDev = Math.max(rawStdDev, 0.05 * mean, 1.0);

    const zScore = (dur - mean) / stdDev;
    return {
      isAnomaly: zScore > this.anomalyThreshold,
      zScore: Math.round(zScore * 100) / 100,
      mean: Math.round(mean * 100) / 100,
      stdDev: Math.round(stdDev * 100) / 100,
    };
  }

  computeWorkloadSkew() {
    if (this.agentStats.size <= 1) {
      return { giniCoefficient: 0, isImbalanced: false };
    }

    const counts = Array.from(this.agentStats.values()).map((s) => s.turnCount).sort((a, b) => a - b);
    const n = counts.length;
    const total = counts.reduce((acc, c) => acc + c, 0);

    if (total === 0) {
      return { giniCoefficient: 0, isImbalanced: false };
    }

    let diffSum = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        diffSum += Math.abs(counts[i] - counts[j]);
      }
    }

    const gini = diffSum / (2 * n * total);
    return {
      giniCoefficient: Math.round(gini * 1000) / 1000,
      isImbalanced: gini > 0.4, // Gini > 0.4 indicates significant workload imbalance
    };
  }

  getSnapshot() {
    if (this.turns.length === 0) {
      return {
        totalTurns: 0,
        successRate: 1.0,
        meanDurationMs: 0,
        p50DurationMs: 0,
        p90DurationMs: 0,
        p99DurationMs: 0,
        workloadSkew: { giniCoefficient: 0, isImbalanced: false },
        agentBreakdown: {},
      };
    }

    const durations = this.turns.map((t) => t.durationMs).sort((a, b) => a - b);
    const n = durations.length;
    const mean = durations.reduce((acc, d) => acc + d, 0) / n;
    const successTotal = this.turns.filter((t) => t.success).length;

    const getPercentile = (p) => {
      const idx = (p / 100) * (n - 1);
      const lower = Math.floor(idx);
      const upper = Math.ceil(idx);
      if (lower === upper) return durations[lower];
      const weight = idx - lower;
      return durations[lower] * (1 - weight) + durations[upper] * weight;
    };

    const breakdown = {};
    for (const [id, stats] of this.agentStats.entries()) {
      breakdown[id] = {
        role: stats.role,
        turnCount: stats.turnCount,
        successRate: stats.turnCount > 0 ? Math.round((stats.successCount / stats.turnCount) * 1000) / 1000 : 0,
        avgDurationMs: stats.turnCount > 0 ? Math.round((stats.totalDurationMs / stats.turnCount) * 10) / 10 : 0,
        totalTokens: stats.totalTokens,
      };
    }

    return {
      totalTurns: n,
      successRate: Math.round((successTotal / n) * 1000) / 1000,
      meanDurationMs: Math.round(mean * 10) / 10,
      p50DurationMs: Math.round(getPercentile(50) * 10) / 10,
      p90DurationMs: Math.round(getPercentile(90) * 10) / 10,
      p99DurationMs: Math.round(getPercentile(99) * 10) / 10,
      workloadSkew: this.computeWorkloadSkew(),
      agentBreakdown: breakdown,
    };
  }

  exportPrometheus() {
    const snap = this.getSnapshot();
    const lines = [
      '# HELP agentcore_turns_total Total executed agent turns',
      '# TYPE agentcore_turns_total counter',
      `agentcore_turns_total ${snap.totalTurns}`,
      '# HELP agentcore_success_ratio Proportion of successful turns',
      '# TYPE agentcore_success_ratio gauge',
      `agentcore_success_ratio ${snap.successRate.toFixed(4)}`,
      '# HELP agentcore_turn_duration_ms Turn duration percentiles',
      '# TYPE agentcore_turn_duration_ms gauge',
      `agentcore_turn_duration_ms{quantile="0.50"} ${snap.p50DurationMs}`,
      `agentcore_turn_duration_ms{quantile="0.90"} ${snap.p90DurationMs}`,
      `agentcore_turn_duration_ms{quantile="0.99"} ${snap.p99DurationMs}`,
      '# HELP agentcore_workload_gini Gini coefficient of workload distribution across agents',
      '# TYPE agentcore_workload_gini gauge',
      `agentcore_workload_gini ${snap.workloadSkew.giniCoefficient}`,
    ];

    for (const [agentId, info] of Object.entries(snap.agentBreakdown)) {
      lines.push(`agentcore_agent_turns_total{agent="${agentId}",role="${info.role}"} ${info.turnCount}`);
    }

    return lines.join('\n') + '\n';
  }

  reset() {
    this.turns = [];
    this.agentStats.clear();
  }
}
