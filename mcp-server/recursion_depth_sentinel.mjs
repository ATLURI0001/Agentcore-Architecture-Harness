/**
 * Subagent Recursion Depth and Execution Cycle Sentinel.
 * 
 * Guards against unbounded subagent delegation cascades, cyclic delegation loops,
 * and excessive branching factors in multi-agent orchestration architectures.
 * Resolves INC-2026-AGENT-6102.
 */

export class RecursionDepthExceededError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'RecursionDepthExceededError';
    this.details = details;
  }
}

export class DelegationCycleDetectedError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'DelegationCycleDetectedError';
    this.details = details;
  }
}

export class BranchingFactorExceededError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BranchingFactorExceededError';
    this.details = details;
  }
}

export class RecursionDepthSentinel {
  /**
   * @param {Object} [options]
   * @param {number} [options.maxDepth=8] Maximum allowed delegation recursion depth
   * @param {number} [options.maxBranching=10] Maximum subagents spawned by a single parent span
   * @param {boolean} [options.allowCycles=false] Whether cyclic re-entry is tolerated
   */
  constructor(options = {}) {
    this.maxDepth = Math.max(1, options.maxDepth ?? 8);
    this.maxBranching = Math.max(1, options.maxBranching ?? 10);
    this.allowCycles = Boolean(options.allowCycles ?? false);

    // spanId -> SpanRecord
    this.spans = new Map();
    // parentSpanId -> Set of childSpanIds
    this.childrenByParent = new Map();

    // Diagnostics
    this.metrics = {
      totalSpansCreated: 0,
      activeSpans: 0,
      maxDepthObserved: 0,
      depthViolations: 0,
      cycleViolations: 0,
      branchingViolations: 0,
    };
  }

  /**
   * Enters a new subagent execution span, enforcing recursion depth, cycle, and branching limits.
   *
   * @param {Object} params
   * @param {string} params.spanId Unique identifier for this span
   * @param {string} [params.parentSpanId] Parent span ID (undefined if root)
   * @param {string} params.agentId Invoking parent or source agent ID
   * @param {string} params.subagentId Target child subagent ID being invoked
   * @param {string} [params.taskType="general"] Classification of delegated task
   * @returns {Object} Created span record
   */
  enterSpan({ spanId, parentSpanId, agentId, subagentId, taskType = 'general' }) {
    if (!spanId || typeof spanId !== 'string') {
      throw new TypeError('spanId must be a non-empty string');
    }
    if (!subagentId || typeof subagentId !== 'string') {
      throw new TypeError('subagentId must be a non-empty string');
    }
    if (this.spans.has(spanId)) {
      throw new Error(`Span '${spanId}' is already active`);
    }

    let depth = 1;
    const callStack = [subagentId];

    if (parentSpanId) {
      const parent = this.spans.get(parentSpanId);
      if (!parent) {
        throw new Error(`Parent span '${parentSpanId}' not found or already closed`);
      }

      // Check branching limit
      const siblings = this.childrenByParent.get(parentSpanId) || new Set();
      if (siblings.size >= this.maxBranching) {
        this.metrics.branchingViolations++;
        throw new BranchingFactorExceededError(
          `Parent span '${parentSpanId}' exceeded max branching factor of ${this.maxBranching} (attempted #${siblings.size + 1})`,
          { parentSpanId, maxBranching: this.maxBranching }
        );
      }

      // Compute call stack & depth
      let curr = parent;
      depth = curr.depth + 1;
      callStack.unshift(...curr.callStack);

      // Check depth limit
      if (depth > this.maxDepth) {
        this.metrics.depthViolations++;
        throw new RecursionDepthExceededError(
          `Subagent delegation depth ${depth} exceeds maximum limit of ${this.maxDepth}`,
          { spanId, depth, maxDepth: this.maxDepth, callStack }
        );
      }

      // Check cyclic recursion (subagent already in ancestry)
      if (!this.allowCycles && curr.callStack.includes(subagentId)) {
        this.metrics.cycleViolations++;
        throw new DelegationCycleDetectedError(
          `Cyclic subagent delegation detected: '${subagentId}' already present in call chain [${curr.callStack.join(' -> ')}]`,
          { spanId, subagentId, callStack: [...curr.callStack, subagentId] }
        );
      }

      siblings.add(spanId);
      this.childrenByParent.set(parentSpanId, siblings);
    }

    const spanRecord = {
      spanId,
      parentSpanId: parentSpanId || null,
      agentId: agentId || 'root',
      subagentId,
      taskType,
      depth,
      callStack,
      startTime: Date.now(),
      status: 'ACTIVE',
    };

    this.spans.set(spanId, spanRecord);
    this.metrics.totalSpansCreated++;
    this.metrics.activeSpans++;
    if (depth > this.metrics.maxDepthObserved) {
      this.metrics.maxDepthObserved = depth;
    }

    return { ...spanRecord };
  }

  /**
   * Exits and closes an active span.
   *
   * @param {string} spanId
   * @returns {Object} Closed span summary
   */
  exitSpan(spanId) {
    const span = this.spans.get(spanId);
    if (!span) {
      throw new Error(`Cannot exit span '${spanId}': span does not exist or is already closed`);
    }

    span.status = 'COMPLETED';
    span.endTime = Date.now();
    span.durationMs = span.endTime - span.startTime;

    this.spans.delete(spanId);
    this.childrenByParent.delete(spanId);
    this.metrics.activeSpans = Math.max(0, this.metrics.activeSpans - 1);

    if (span.parentSpanId) {
      const siblings = this.childrenByParent.get(span.parentSpanId);
      if (siblings) {
        siblings.delete(spanId);
      }
    }

    return { ...span };
  }

  /**
   * Returns current call stack from root to target span.
   *
   * @param {string} spanId
   * @returns {string[]}
   */
  getCallStack(spanId) {
    const span = this.spans.get(spanId);
    if (!span) return [];
    return [...span.callStack];
  }

  /**
   * Retrieves diagnostic metrics.
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Resets all internal state and metrics.
   */
  reset() {
    this.spans.clear();
    this.childrenByParent.clear();
    this.metrics = {
      totalSpansCreated: 0,
      activeSpans: 0,
      maxDepthObserved: 0,
      depthViolations: 0,
      cycleViolations: 0,
      branchingViolations: 0,
    };
  }
}
