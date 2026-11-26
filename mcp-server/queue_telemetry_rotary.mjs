/**
 * Agentcore Queue Depth & Execution Lag Telemetry Rotary.
 * 
 * High-performance circular buffer ring for tracking tool invocation
 * queue depths, wait latencies, execution lag, and worker pool saturation.
 */

export class QueueTelemetryRotary {
  /**
   * @param {number} capacity Maximum ring buffer capacity (default: 500)
   * @param {number} workerPoolCapacity Total concurrent worker pool capacity (default: 16)
   */
  constructor(capacity = 500, workerPoolCapacity = 16) {
    if (capacity <= 0) throw new Error('Capacity must be positive');
    if (workerPoolCapacity <= 0) throw new Error('Worker pool capacity must be positive');

    this.capacity = capacity;
    this.workerPoolCapacity = workerPoolCapacity;
    this.buffer = new Array(capacity);
    this.head = 0;
    this.count = 0;
    this.totalRecorded = 0;
  }

  /**
   * Records a queue and execution observation.
   * @param {Object} entry
   * @param {string} entry.toolName
   * @param {number} entry.queueDepth Current waiting queue length
   * @param {number} entry.activeWorkers Active executing workers
   * @param {number} entry.pendingLagMs Milliseconds spent waiting in queue
   * @param {number} entry.executionDurationMs Milliseconds spent executing tool
   * @param {boolean} [entry.success=true] Whether execution succeeded
   * @param {number} [entry.timestamp] Epoch milliseconds
   */
  record({
    toolName,
    queueDepth,
    activeWorkers,
    pendingLagMs,
    executionDurationMs,
    success = true,
    timestamp = Date.now(),
  }) {
    if (!toolName) throw new Error('toolName is required');

    const item = {
      toolName,
      queueDepth: Math.max(0, queueDepth),
      activeWorkers: Math.max(0, activeWorkers),
      pendingLagMs: Math.max(0, pendingLagMs),
      executionDurationMs: Math.max(0, executionDurationMs),
      success: Boolean(success),
      timestamp,
    };

    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
    this.totalRecorded++;
  }

  /**
   * Returns recent entries in chronological order.
   * @param {number} [limit]
   */
  getRecent(limit = this.count) {
    const fetchCount = Math.min(limit, this.count);
    const result = new Array(fetchCount);

    let start = (this.head - this.count + this.capacity) % this.capacity;
    if (limit < this.count) {
      start = (this.head - limit + this.capacity) % this.capacity;
    }

    for (let i = 0; i < fetchCount; i++) {
      result[i] = this.buffer[(start + i) % this.capacity];
    }
    return result;
  }

  /**
   * Calculates percentiles for a numerical metric.
   * @param {'pendingLagMs' | 'executionDurationMs' | 'queueDepth'} field
   * @param {number[]} percentiles e.g. [50, 90, 99]
   */
  getQuantiles(field, percentiles = [50, 90, 99]) {
    if (this.count === 0) {
      return percentiles.reduce((acc, p) => ({ ...acc, [`p${p}`]: 0 }), {});
    }

    const values = [];
    const entries = this.getRecent();
    for (let i = 0; i < entries.length; i++) {
      values.push(entries[i][field]);
    }
    values.sort((a, b) => a - b);

    const quantiles = {};
    for (const p of percentiles) {
      if (p <= 0) quantiles[`p${p}`] = values[0];
      else if (p >= 100) quantiles[`p${p}`] = values[values.length - 1];
      else {
        const idx = Math.floor((p / 100) * (values.length - 1));
        quantiles[`p${p}`] = values[idx];
      }
    }
    return quantiles;
  }

  /**
   * Aggregates telemetry summary and saturation metrics.
   */
  getSummary() {
    if (this.count === 0) {
      return {
        sampleCount: 0,
        totalRecorded: this.totalRecorded,
        maxQueueDepth: 0,
        maxLagMs: 0,
        poolSaturationRatio: 0,
        errorRatePercent: 0,
        lagQuantiles: { p50: 0, p90: 0, p99: 0 },
        durationQuantiles: { p50: 0, p90: 0, p99: 0 },
      };
    }

    const entries = this.getRecent();
    let maxQueue = 0;
    let maxLag = 0;
    let totalActiveWorkers = 0;
    let failureCount = 0;

    for (const e of entries) {
      if (e.queueDepth > maxQueue) maxQueue = e.queueDepth;
      if (e.pendingLagMs > maxLag) maxLag = e.pendingLagMs;
      totalActiveWorkers += e.activeWorkers;
      if (!e.success) failureCount++;
    }

    const avgActive = totalActiveWorkers / this.count;
    const poolSaturationRatio = Math.min(1.0, avgActive / this.workerPoolCapacity);
    const errorRatePercent = (failureCount / this.count) * 100;

    return {
      sampleCount: this.count,
      totalRecorded: this.totalRecorded,
      maxQueueDepth: maxQueue,
      maxLagMs: maxLag,
      poolSaturationRatio: Number(poolSaturationRatio.toFixed(4)),
      errorRatePercent: Number(errorRatePercent.toFixed(2)),
      lagQuantiles: this.getQuantiles('pendingLagMs', [50, 90, 99]),
      durationQuantiles: this.getQuantiles('executionDurationMs', [50, 90, 99]),
    };
  }

  /**
   * Resets the rotary buffer.
   */
  reset() {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.count = 0;
    this.totalRecorded = 0;
  }
}
