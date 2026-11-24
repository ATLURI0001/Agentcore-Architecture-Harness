/**
 * @file cyclic_dependency_guard.mjs
 * Multi-Agent Workflow DAG & Cyclic Dependency Circuit Guard.
 *
 * Intercepts dynamic agent subtask delegations and workflow chaining,
 * detects circular dependencies in real time, enforces maximum workflow recursion depth,
 * and executes graceful fallback quarantine to prevent multi-agent freeze states.
 */

export const GuardAction = Object.freeze({
  ALLOW: 'ALLOW',
  QUARANTINE_CYCLE: 'QUARANTINE_CYCLE',
  REJECT_SELF_LOOP: 'REJECT_SELF_LOOP',
  DEPTH_EXCEEDED: 'DEPTH_EXCEEDED',
  CAPACITY_EXCEEDED: 'CAPACITY_EXCEEDED',
});

export class CyclicDependencyGuard {
  /**
   * @param {Object} [options]
   * @param {number} [options.maxDepth=16] Maximum allowable dependency tree depth
   * @param {number} [options.maxNodes=256] Maximum active nodes in the workflow DAG
   * @param {Function} [options.onCycleDetected] Custom quarantine or mitigation callback
   */
  constructor(options = {}) {
    this.maxDepth = Math.max(1, Number(options.maxDepth) || 16);
    this.maxNodes = Math.max(10, Number(options.maxNodes) || 256);
    this.onCycleDetected = typeof options.onCycleDetected === 'function' ? options.onCycleDetected : null;

    // Adjacency list: fromTask -> Set of toTasks (fromTask depends on toTask)
    this.adj = new Map();
    // Reverse adjacency list: toTask -> Set of fromTasks (for in-degree and dependents)
    this.revAdj = new Map();
    // Metadata map
    this.edgeMeta = new Map();

    this.metrics = {
      totalDependenciesEvaluated: 0,
      dependenciesAllowed: 0,
      cyclesBlocked: 0,
      selfLoopsBlocked: 0,
      depthViolations: 0,
    };
  }

  /**
   * Evaluates and attempts to register a directed dependency: fromTask depends on toTask (fromTask -> toTask).
   * @param {string} fromTask
   * @param {string} toTask
   * @param {Object} [metadata]
   * @returns {Object} Guard verdict and diagnostic metadata
   */
  addDependency(fromTask, toTask, metadata = {}) {
    this.metrics.totalDependenciesEvaluated++;

    const from = String(fromTask || '').trim();
    const to = String(toTask || '').trim();

    if (!from || !to) {
      throw new TypeError('Task identifiers must be non-empty strings');
    }

    // 1. Direct Self-Loop Check
    if (from === to) {
      this.metrics.selfLoopsBlocked++;
      return {
        allowed: false,
        action: GuardAction.REJECT_SELF_LOOP,
        cyclePath: [from, to],
        reason: `Self-referential dependency rejected: task '${from}' cannot depend on itself`,
      };
    }

    // 2. Capacity Check
    const allNodes = new Set([...this.adj.keys(), ...this.revAdj.keys()]);
    if (!allNodes.has(from) && allNodes.size >= this.maxNodes) {
      return {
        allowed: false,
        action: GuardAction.CAPACITY_EXCEEDED,
        reason: `Workflow DAG capacity exceeded (max ${this.maxNodes} nodes)`,
      };
    }

    // 3. Cycle Detection via DFS: Can we reach 'from' starting from 'to'?
    // If a path exists from 'to' to 'from', adding (from -> to) would close a directed cycle!
    const cyclePath = this._findPath(to, from);
    if (cyclePath) {
      this.metrics.cyclesBlocked++;
      const fullCycle = [from, ...cyclePath];
      const result = {
        allowed: false,
        action: GuardAction.QUARANTINE_CYCLE,
        cyclePath: fullCycle,
        reason: `Cyclic workflow dependency detected: ${fullCycle.join(' -> ')}`,
      };

      if (this.onCycleDetected) {
        try {
          this.onCycleDetected(fullCycle, { from, to, metadata });
        } catch (err) {
          // Guard callback isolation
        }
      }

      return result;
    }

    // 4. Maximum Chain Depth Check
    const currentMaxDepth = this._calculateMaxPathLength(to) + 1;
    if (currentMaxDepth > this.maxDepth) {
      this.metrics.depthViolations++;
      return {
        allowed: false,
        action: GuardAction.DEPTH_EXCEEDED,
        depth: currentMaxDepth,
        reason: `Maximum workflow dependency depth (${this.maxDepth}) exceeded by path of length ${currentMaxDepth}`,
      };
    }

    // 5. Admitted: Update Graph
    if (!this.adj.has(from)) this.adj.set(from, new Set());
    if (!this.adj.has(to)) this.adj.set(to, new Set());
    if (!this.revAdj.has(from)) this.revAdj.set(from, new Set());
    if (!this.revAdj.has(to)) this.revAdj.set(to, new Set());

    this.adj.get(from).add(to);
    this.revAdj.get(to).add(from);

    const edgeKey = `${from}->${to}`;
    this.edgeMeta.set(edgeKey, { ...metadata, createdAt: Date.now() });
    this.metrics.dependenciesAllowed++;

    return {
      allowed: true,
      action: GuardAction.ALLOW,
      reason: 'Dependency accepted within DAG invariants',
    };
  }

  /**
   * Removes a previously registered dependency edge.
   */
  removeDependency(fromTask, toTask) {
    const from = String(fromTask || '').trim();
    const to = String(toTask || '').trim();

    const fromSet = this.adj.get(from);
    if (fromSet && fromSet.has(to)) {
      fromSet.delete(to);
      const toSet = this.revAdj.get(to);
      if (toSet) toSet.delete(from);

      this.edgeMeta.delete(`${from}->${to}`);
      return true;
    }
    return false;
  }

  /**
   * Computes Kahn's topological sort for valid scheduling order.
   * @returns {string[]} Ordered task identifiers
   */
  getTopologicalOrder() {
    const inDegree = new Map();
    const allNodes = new Set([...this.adj.keys(), ...this.revAdj.keys()]);

    for (const node of allNodes) {
      const deps = this.adj.get(node);
      inDegree.set(node, deps ? deps.size : 0);
    }

    // Queue nodes with in-degree 0 (no dependencies)
    const queue = [];
    for (const [node, deg] of inDegree.entries()) {
      if (deg === 0) {
        queue.push(node);
      }
    }

    const order = [];
    while (queue.length > 0) {
      const u = queue.shift();
      order.push(u);

      const dependents = this.revAdj.get(u) || new Set();
      for (const v of dependents) {
        const curDeg = inDegree.get(v) - 1;
        inDegree.set(v, curDeg);
        if (curDeg === 0) {
          queue.push(v);
        }
      }
    }

    if (order.length !== allNodes.size) {
      throw new Error('Graph contains unresolved cycles; topological sort impossible');
    }

    return order;
  }

  /**
   * Internal DFS path finder from start to target.
   * @returns {string[] | null} Path array if reachable, otherwise null.
   */
  _findPath(start, target, visited = new Set(), currentPath = []) {
    visited.add(start);
    currentPath.push(start);

    if (start === target) {
      return [...currentPath];
    }

    const neighbors = this.adj.get(start);
    if (neighbors) {
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          const path = this._findPath(neighbor, target, visited, currentPath);
          if (path) return path;
        }
      }
    }

    currentPath.pop();
    return null;
  }

  /**
   * Computes length of longest directed path starting from node.
   */
  _calculateMaxPathLength(node, memo = new Map(), visited = new Set()) {
    if (memo.has(node)) return memo.get(node);
    if (visited.has(node)) return 0; // Avoid infinite loop in case of corrupt state

    visited.add(node);
    let maxSub = 0;
    const neighbors = this.adj.get(node);
    if (neighbors && neighbors.size > 0) {
      for (const neighbor of neighbors) {
        maxSub = Math.max(maxSub, 1 + this._calculateMaxPathLength(neighbor, memo, visited));
      }
    }
    visited.delete(node);

    memo.set(node, maxSub);
    return maxSub;
  }

  /**
   * Returns current DAG size and operational metrics.
   */
  getMetrics() {
    const allNodes = new Set([...this.adj.keys(), ...this.revAdj.keys()]);
    let edgeCount = 0;
    for (const set of this.adj.values()) {
      edgeCount += set.size;
    }

    return {
      activeNodes: allNodes.size,
      activeEdges: edgeCount,
      ...this.metrics,
    };
  }

  /**
   * Resets graph and metric states.
   */
  reset() {
    this.adj.clear();
    this.revAdj.clear();
    this.edgeMeta.clear();
    this.metrics.totalDependenciesEvaluated = 0;
    this.metrics.dependenciesAllowed = 0;
    this.metrics.cyclesBlocked = 0;
    this.metrics.selfLoopsBlocked = 0;
    this.metrics.depthViolations = 0;
  }
}
