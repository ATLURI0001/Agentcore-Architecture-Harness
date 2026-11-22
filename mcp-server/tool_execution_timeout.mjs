/**
 * Tool Execution Timeout and Deadman Circuit Breaker Engine.
 * Enforces per-tool execution deadlines with AbortController signal propagation,
 * automatic circuit breaker tripping on consecutive timeouts, and graceful recovery.
 */

export class ToolTimeoutError extends Error {
  /**
   * @param {string} toolName
   * @param {number} timeoutMs
   */
  constructor(toolName, timeoutMs) {
    super(`Tool '${toolName}' execution timed out after ${timeoutMs}ms`);
    this.name = 'ToolTimeoutError';
    this.toolName = toolName;
    this.timeoutMs = timeoutMs;
  }
}

export class ToolCircuitOpenError extends Error {
  /**
   * @param {string} toolName
   * @param {number} cooldownRemainingMs
   */
  constructor(toolName, cooldownRemainingMs) {
    super(`Circuit breaker for tool '${toolName}' is OPEN (${cooldownRemainingMs}ms cooldown remaining)`);
    this.name = 'ToolCircuitOpenError';
    this.toolName = toolName;
    this.cooldownRemainingMs = cooldownRemainingMs;
  }
}

export class ToolTimeoutManager {
  /**
   * @param {Object} [options={}]
   * @param {number} [options.defaultTimeoutMs=5000] - Default timeout for tool invocations.
   * @param {number} [options.maxConsecutiveTimeouts=3] - Failures before circuit trips OPEN.
   * @param {number} [options.cooldownPeriodMs=10000] - Duration circuit stays OPEN before HALF_OPEN probe.
   * @param {Function} [options.clockFn=Date.now] - Clock function for deterministic tests.
   */
  constructor(options = {}) {
    const timeout = Number(options.defaultTimeoutMs);
    this.defaultTimeoutMs = Number.isFinite(timeout) && timeout >= 10 ? timeout : 5000;

    const maxTimeouts = Number(options.maxConsecutiveTimeouts);
    this.maxConsecutiveTimeouts = Number.isInteger(maxTimeouts) && maxTimeouts >= 1 ? maxTimeouts : 3;

    const cooldown = Number(options.cooldownPeriodMs);
    this.cooldownPeriodMs = Number.isFinite(cooldown) && cooldown >= 100 ? cooldown : 10000;

    this.clockFn = typeof options.clockFn === 'function' ? options.clockFn : Date.now;

    /** @type {Map<string, { state: 'CLOSED' | 'OPEN' | 'HALF_OPEN', consecutiveTimeouts: number, lastTripTime: number }>} */
    this.circuits = new Map();

    this.stats = {
      executedTotal: 0,
      completedTotal: 0,
      timedOutTotal: 0,
      trippedTotal: 0,
      rejectedTotal: 0,
    };
  }

  /**
   * Retrieves or initializes circuit breaker state for a tool.
   * @param {string} toolName
   * @returns {{ state: 'CLOSED' | 'OPEN' | 'HALF_OPEN', consecutiveTimeouts: number, lastTripTime: number }}
   */
  _getCircuit(toolName) {
    const key = String(toolName || 'unknown').trim().toLowerCase();
    let circuit = this.circuits.get(key);
    if (!circuit) {
      circuit = {
        state: 'CLOSED',
        consecutiveTimeouts: 0,
        lastTripTime: 0,
      };
      this.circuits.set(key, circuit);
    }
    return circuit;
  }

  /**
   * Executes an asynchronous tool function wrapped with deadline enforcement and circuit checking.
   * @template T
   * @param {string} toolName
   * @param {string} agentId
   * @param {(signal: AbortSignal) => Promise<T>} fn
   * @param {number} [customTimeoutMs]
   * @returns {Promise<T>}
   */
  async execute(toolName, agentId, fn, customTimeoutMs) {
    const cleanTool = String(toolName || 'unknown').trim().toLowerCase();
    const circuit = this._getCircuit(cleanTool);
    const now = this.clockFn();

    // Check circuit breaker status
    if (circuit.state === 'OPEN') {
      const elapsed = now - circuit.lastTripTime;
      if (elapsed < this.cooldownPeriodMs) {
        this.stats.rejectedTotal++;
        throw new ToolCircuitOpenError(cleanTool, this.cooldownPeriodMs - elapsed);
      }
      // Cooldown elapsed: transition to HALF_OPEN probe
      circuit.state = 'HALF_OPEN';
    }

    const effectiveTimeout = Number.isFinite(customTimeoutMs) && customTimeoutMs > 0
      ? customTimeoutMs
      : this.defaultTimeoutMs;

    this.stats.executedTotal++;
    const controller = new AbortController();
    let timer = null;

    try {
      const result = await Promise.race([
        fn(controller.signal),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort(new Error(`Timeout of ${effectiveTimeout}ms exceeded`));
            reject(new ToolTimeoutError(cleanTool, effectiveTimeout));
          }, effectiveTimeout);
        }),
      ]);

      // Success: tool completed within deadline
      if (timer) clearTimeout(timer);
      this.stats.completedTotal++;

      if (circuit.state === 'HALF_OPEN' || circuit.consecutiveTimeouts > 0) {
        circuit.state = 'CLOSED';
        circuit.consecutiveTimeouts = 0;
      }

      return result;
    } catch (err) {
      if (timer) clearTimeout(timer);

      if (err instanceof ToolTimeoutError) {
        this.stats.timedOutTotal++;
        circuit.consecutiveTimeouts++;

        if (circuit.consecutiveTimeouts >= this.maxConsecutiveTimeouts) {
          circuit.state = 'OPEN';
          circuit.lastTripTime = this.clockFn();
          this.stats.trippedTotal++;
        }
      }
      throw err;
    }
  }

  /**
   * Gathers live telemetry and circuit breaker status across all tools.
   */
  getTelemetry() {
    const circuitsSummary = {};
    for (const [tool, state] of this.circuits.entries()) {
      circuitsSummary[tool] = {
        state: state.state,
        consecutiveTimeouts: state.consecutiveTimeouts,
        lastTripTime: state.lastTripTime,
      };
    }

    return {
      stats: { ...this.stats },
      circuits: circuitsSummary,
    };
  }

  /**
   * Resets all internal circuits and counters.
   */
  reset() {
    this.circuits.clear();
    this.stats = {
      executedTotal: 0,
      completedTotal: 0,
      timedOutTotal: 0,
      trippedTotal: 0,
      rejectedTotal: 0,
    };
  }
}
