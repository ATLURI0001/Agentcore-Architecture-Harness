/**
 * Inter-Agent Message Transit Latency & Ring Buffer Saturation Telemetry for Agentcore.
 *
 * Instruments message delivery pipelines between autonomous agents, monitors hop latency,
 * tracks circular ring buffer queue saturation and backpressure, and exports Prometheus metrics.
 */

export class MessageTransitTelemetry {
  constructor(options = {}) {
    this.maxHistory = Number.isInteger(options.maxHistory) && options.maxHistory > 0 ? options.maxHistory : 1000;
    this.saturationWarningThreshold =
      typeof options.saturationWarningThreshold === 'number' && options.saturationWarningThreshold > 0
        ? options.saturationWarningThreshold
        : 0.8;
    this.saturationCriticalThreshold =
      typeof options.saturationCriticalThreshold === 'number' && options.saturationCriticalThreshold > 0
        ? options.saturationCriticalThreshold
        : 0.95;
    this.latencyAnomalyThresholdMs =
      typeof options.latencyAnomalyThresholdMs === 'number' && options.latencyAnomalyThresholdMs > 0
        ? options.latencyAnomalyThresholdMs
        : 50.0;

    this.records = [];
    this.pairStats = new Map();
    this.bufferStats = new Map();
    this.droppedCounts = new Map();
  }

  /**
   * Records an inter-agent message transit delivery event.
   */
  recordMessageTransit(input) {
    if (!input || typeof input !== 'object') {
      throw new TypeError('Transit record input must be an object');
    }

    const msgId = String(input.msgId || '').trim();
    if (!msgId) {
      throw new TypeError('msgId must be a non-empty string');
    }
    const srcAgent = String(input.srcAgent || '').trim();
    const dstAgent = String(input.dstAgent || '').trim();
    if (!srcAgent || !dstAgent) {
      throw new TypeError('srcAgent and dstAgent must be non-empty strings');
    }

    const latencyMs = Number(input.transitLatencyMs);
    if (!Number.isFinite(latencyMs) || latencyMs < 0) {
      throw new RangeError('transitLatencyMs must be a non-negative finite number');
    }

    const bufferId = String(input.bufferId || 'default-ring').trim();
    const occupancy = Number.isInteger(input.bufferOccupancy) && input.bufferOccupancy >= 0 ? input.bufferOccupancy : 0;
    const capacity = Number.isInteger(input.bufferCapacity) && input.bufferCapacity > 0 ? input.bufferCapacity : 100;
    const saturation = Number((occupancy / capacity).toFixed(4));
    const timestamp = Number(input.timestamp) || Date.now();

    const record = {
      msgId,
      srcAgent,
      dstAgent,
      bufferId,
      transitLatencyMs: latencyMs,
      bufferOccupancy: occupancy,
      bufferCapacity: capacity,
      saturation,
      timestamp,
    };

    this.records.push(record);
    if (this.records.length > this.maxHistory) {
      this.records.shift();
    }

    // Pair stats
    const pairKey = `${srcAgent}->${dstAgent}`;
    if (!this.pairStats.has(pairKey)) {
      this.pairStats.set(pairKey, {
        srcAgent,
        dstAgent,
        totalTransits: 0,
        totalLatencyMs: 0,
        latencies: [],
      });
    }
    const pStat = this.pairStats.get(pairKey);
    pStat.totalTransits++;
    pStat.totalLatencyMs += latencyMs;
    pStat.latencies.push(latencyMs);
    if (pStat.latencies.length > 500) {
      pStat.latencies.shift();
    }

    // Buffer stats
    this.bufferStats.set(bufferId, {
      bufferId,
      occupancy,
      capacity,
      saturation,
      updatedAt: timestamp,
    });

    return record;
  }

  /**
   * Records a dropped message due to buffer saturation or timeout.
   */
  recordDroppedMessage(bufferId = 'default-ring', reason = 'BUFFER_OVERFLOW') {
    const key = `${bufferId}:${reason}`;
    this.droppedCounts.set(key, (this.droppedCounts.get(key) || 0) + 1);
  }

  /**
   * Calculates transit latency percentiles and summaries.
   */
  getTransitPercentiles(srcAgent = null, dstAgent = null) {
    let dataset = [];
    if (srcAgent && dstAgent) {
      const pairKey = `${srcAgent}->${dstAgent}`;
      dataset = (this.pairStats.get(pairKey)?.latencies || []).slice();
    } else {
      dataset = this.records.map((r) => r.transitLatencyMs);
    }

    if (dataset.length === 0) {
      return { count: 0, meanMs: 0, p50Ms: 0, p90Ms: 0, p99Ms: 0, maxMs: 0 };
    }

    dataset.sort((a, b) => a - b);
    const sum = dataset.reduce((acc, v) => acc + v, 0);

    return {
      count: dataset.length,
      meanMs: Number((sum / dataset.length).toFixed(3)),
      p50Ms: Number((dataset[Math.floor(dataset.length * 0.5)] || 0).toFixed(3)),
      p90Ms: Number((dataset[Math.floor(dataset.length * 0.9)] || 0).toFixed(3)),
      p99Ms: Number((dataset[Math.floor(dataset.length * 0.99)] || 0).toFixed(3)),
      maxMs: Number((dataset[dataset.length - 1] || 0).toFixed(3)),
    };
  }

  /**
   * Returns saturation diagnostics across ring buffers.
   */
  getBufferSaturationReport() {
    const report = [];
    for (const [bufferId, stat] of this.bufferStats.entries()) {
      let status = 'HEALTHY';
      if (stat.saturation >= this.saturationCriticalThreshold) {
        status = 'CRITICAL';
      } else if (stat.saturation >= this.saturationWarningThreshold) {
        status = 'WARNING';
      }

      report.push({
        bufferId,
        occupancy: stat.occupancy,
        capacity: stat.capacity,
        saturationRatio: stat.saturation,
        status,
      });
    }
    return report;
  }

  /**
   * Scans for latency spikes and saturated buffer alerts.
   */
  detectTransitAnomalies() {
    const anomalies = [];

    // Latency spikes
    for (const [pairKey, stat] of this.pairStats.entries()) {
      if (stat.latencies.length < 5) continue;
      const sorted = [...stat.latencies].sort((a, b) => a - b);
      const p90 = sorted[Math.floor(sorted.length * 0.9)] || 0;
      if (p90 > this.latencyAnomalyThresholdMs) {
        anomalies.push({
          type: 'HIGH_TRANSIT_LATENCY',
          target: pairKey,
          value: p90,
          threshold: this.latencyAnomalyThresholdMs,
          message: `Inter-agent hop ${pairKey} P90 latency (${p90.toFixed(1)}ms) exceeds threshold`,
        });
      }
    }

    // Buffer saturation
    for (const [bufferId, stat] of this.bufferStats.entries()) {
      if (stat.saturation >= this.saturationCriticalThreshold) {
        anomalies.push({
          type: 'CRITICAL_BUFFER_SATURATION',
          target: bufferId,
          value: stat.saturation,
          threshold: this.saturationCriticalThreshold,
          message: `Buffer ${bufferId} is at ${(stat.saturation * 100).toFixed(1)}% capacity`,
        });
      }
    }

    return anomalies;
  }

  /**
   * Formats Prometheus OpenMetrics text exposition.
   */
  exportPrometheusMetrics() {
    const lines = [
      '# HELP agentcore_transit_latency_p90_ms Inter-agent message transit P90 latency in ms',
      '# TYPE agentcore_transit_latency_p90_ms gauge',
      '# HELP agentcore_buffer_saturation_ratio Ring buffer occupancy ratio [0-1]',
      '# TYPE agentcore_buffer_saturation_ratio gauge',
      '# HELP agentcore_dropped_messages_total Total messages dropped by buffer',
      '# TYPE agentcore_dropped_messages_total counter',
    ];

    for (const [pairKey, stat] of this.pairStats.entries()) {
      const sorted = [...stat.latencies].sort((a, b) => a - b);
      const p90 = sorted[Math.floor(sorted.length * 0.9)] || 0;
      lines.push(
        `agentcore_transit_latency_p90_ms{src="${stat.srcAgent}",dst="${stat.dstAgent}"} ${p90.toFixed(2)}`
      );
    }

    for (const [bufferId, stat] of this.bufferStats.entries()) {
      lines.push(`agentcore_buffer_saturation_ratio{buffer_id="${bufferId}"} ${stat.saturation.toFixed(4)}`);
    }

    for (const [key, count] of this.droppedCounts.entries()) {
      const [bufferId, reason] = key.split(':');
      lines.push(`agentcore_dropped_messages_total{buffer_id="${bufferId}",reason="${reason}"} ${count}`);
    }

    return lines.join('\n') + '\n';
  }

  reset() {
    this.records = [];
    this.pairStats.clear();
    this.bufferStats.clear();
    this.droppedCounts.clear();
  }
}
