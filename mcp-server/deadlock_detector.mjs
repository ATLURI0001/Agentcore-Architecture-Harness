/**
 * Agentcore-Architecture-Harness
 * Multi-Agent Deadlock Detector & Wait-For-Graph Cycle Resolver
 *
 * Tracks inter-agent communication dependencies, shared MCP resource leases,
 * and detects circular wait deadlocks using graph cycle analysis with configurable
 * automated resolution policies (victim selection, timeout preemption).
 */

export const ResolutionStrategy = {
  PREEMPT_NEWEST: 'PREEMPT_NEWEST',
  PREEMPT_OLDEST: 'PREEMPT_OLDEST',
  TIMEOUT_BREAKER: 'TIMEOUT_BREAKER',
};

export class AgentDeadlockDetector {
  /**
   * @param {Object} [options]
   * @param {number} [options.defaultTimeoutMs=30000] Default wait timeout in ms
   * @param {string} [options.strategy=ResolutionStrategy.PREEMPT_NEWEST]
   */
  constructor(options = {}) {
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30000;
    this.strategy = options.strategy ?? ResolutionStrategy.PREEMPT_NEWEST;

    // Map<waitingAgentId, { targetId: string, resource: string, startTime: number, timeoutMs: number }>
    this.waitGraph = new Map();

    // Priority map: Map<agentId, number> (higher number = higher priority)
    this.agentPriorities = new Map();

    this.telemetry = {
      totalWaitsRecorded: 0,
      activeEdges: 0,
      deadlocksDetected: 0,
      deadlocksResolved: 0,
      timeoutsTripped: 0,
    };
  }

  setAgentPriority(agentId, priority) {
    this.agentPriorities.set(String(agentId), Number(priority));
  }

  /**
   * Records an agent waiting on another agent or resource
   * @param {string} waiterId
   * @param {string} targetId
   * @param {Object} [meta]
   */
  addWaitDependency(waiterId, targetId, meta = {}) {
    if (!waiterId || !targetId) {
      throw new Error('waiterId and targetId must be non-empty strings');
    }
    if (waiterId === targetId) {
      throw new Error(`Self-dependency deadlock detected: agent ${waiterId} cannot wait on itself`);
    }

    const w = String(waiterId);
    const t = String(targetId);

    this.waitGraph.set(w, {
      targetId: t,
      resource: meta.resource || 'ipc',
      startTime: meta.startTime || Date.now(),
      timeoutMs: meta.timeoutMs || this.defaultTimeoutMs,
    });

    this.telemetry.totalWaitsRecorded++;
    this.telemetry.activeEdges = this.waitGraph.size;
  }

  /**
   * Removes dependency when response is received or lock is acquired
   * @param {string} waiterId
   */
  removeWaitDependency(waiterId) {
    const deleted = this.waitGraph.delete(String(waiterId));
    this.telemetry.activeEdges = this.waitGraph.size;
    return deleted;
  }

  /**
   * Finds all simple cycles in the Wait-For-Graph using depth-first search
   * @returns {Array<Array<string>>} List of detected cycle paths (e.g. [['A', 'B', 'A']])
   */
  detectCycles() {
    const visited = new Set();
    const inStack = new Set();
    const pathStack = [];
    const detectedCycles = [];

    const dfs = (node) => {
      visited.add(node);
      inStack.add(node);
      pathStack.push(node);

      const edge = this.waitGraph.get(node);
      if (edge) {
        const neighbor = edge.targetId;
        if (!visited.has(neighbor)) {
          dfs(neighbor);
        } else if (inStack.has(neighbor)) {
          // Cycle found: extract cycle slice from pathStack
          const cycleStartIdx = pathStack.indexOf(neighbor);
          if (cycleStartIdx !== -1) {
            const cycle = pathStack.slice(cycleStartIdx).concat(neighbor);
            detectedCycles.push(cycle);
          }
        }
      }

      pathStack.pop();
      inStack.delete(node);
    };

    for (const node of this.waitGraph.keys()) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }

    if (detectedCycles.length > 0) {
      this.telemetry.deadlocksDetected += detectedCycles.length;
    }

    return detectedCycles;
  }

  /**
   * Checks for expired wait dependencies exceeding configured timeout
   * @param {number} [now=Date.now()]
   * @returns {Array<{waiterId: string, targetId: string, elapsedMs: number}>}
   */
  detectTimeouts(now = Date.now()) {
    const timedOut = [];
    for (const [waiterId, edge] of this.waitGraph.entries()) {
      const elapsed = now - edge.startTime;
      if (elapsed > edge.timeoutMs) {
        timedOut.push({
          waiterId,
          targetId: edge.targetId,
          resource: edge.resource,
          elapsedMs: elapsed,
        });
      }
    }
    if (timedOut.length > 0) {
      this.telemetry.timeoutsTripped += timedOut.length;
    }
    return timedOut;
  }

  /**
   * Resolves detected cycles according to configured strategy
   * @returns {Array<{cycle: string[], victimId: string, strategy: string}>}
   */
  resolveDeadlocks() {
    const cycles = this.detectCycles();
    const resolutions = [];

    for (const cycle of cycles) {
      // Distinct nodes in cycle
      const nodes = Array.from(new Set(cycle.slice(0, -1)));
      let victimId = null;

      if (this.strategy === ResolutionStrategy.PREEMPT_NEWEST) {
        // Choose node with newest wait start time, breaking tie with lowest priority
        let newestTime = -1;
        for (const id of nodes) {
          const edge = this.waitGraph.get(id);
          const t = edge ? edge.startTime : 0;
          if (t > newestTime) {
            newestTime = t;
            victimId = id;
          }
        }
      } else if (this.strategy === ResolutionStrategy.PREEMPT_OLDEST) {
        let oldestTime = Infinity;
        for (const id of nodes) {
          const edge = this.waitGraph.get(id);
          const t = edge ? edge.startTime : Infinity;
          if (t < oldestTime) {
            oldestTime = t;
            victimId = id;
          }
        }
      } else {
        // Fallback or lowest priority
        victimId = nodes[0];
      }

      if (victimId) {
        this.removeWaitDependency(victimId);
        this.telemetry.deadlocksResolved++;
        resolutions.push({
          cycle,
          victimId,
          strategy: this.strategy,
        });
      }
    }

    return resolutions;
  }

  getTelemetry() {
    return { ...this.telemetry };
  }

  reset() {
    this.waitGraph.clear();
    this.agentPriorities.clear();
    this.telemetry = {
      totalWaitsRecorded: 0,
      activeEdges: 0,
      deadlocksDetected: 0,
      deadlocksResolved: 0,
      timeoutsTripped: 0,
    };
  }
}
