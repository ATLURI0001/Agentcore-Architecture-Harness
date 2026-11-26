/**
 * Subagent Cascading Failure & Recursive Invocation Circuit Breaker.
 * 
 * Guards multi-agent orchestration swarms against recursive delegation loops,
 * runaway subagent call depth, and cascading worker failure storms.
 */

export const CircuitState = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
};

export class SubagentCircuitBreaker {
  /**
   * @param {Object} options
   * @param {number} [options.maxCallDepth=5] Max allowed nested invocation depth
   * @param {number} [options.failureThreshold=3] Consecutive subagent errors to trip circuit
   * @param {number} [options.recoverySuccessThreshold=2] Consecutive successful calls in HALF_OPEN to close
   * @param {number} [options.cooldownPeriodMs=1000] Milliseconds before transitioning to HALF_OPEN
   */
  constructor(options = {}) {
    this.maxCallDepth = options.maxCallDepth ?? 5;
    this.failureThreshold = options.failureThreshold ?? 3;
    this.recoverySuccessThreshold = options.recoverySuccessThreshold ?? 2;
    this.cooldownPeriodMs = options.cooldownPeriodMs ?? 1000;

    this.roleStates = new Map();
  }

  _getRoleState(role) {
    let state = this.roleStates.get(role);
    if (!state) {
      state = {
        role,
        state: CircuitState.CLOSED,
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        tripTime: 0,
      };
      this.roleStates.set(role, state);
    }
    return state;
  }

  /**
   * Evaluates if a subagent delegation can be safely executed.
   * @param {string} targetRole
   * @param {string[]} currentCallStack e.g. ['coordinator', 'planner', 'coder']
   * @param {number} [now=Date.now()]
   * @returns {{allowed: boolean, state: string, reason?: string}}
   */
  canInvoke(targetRole, currentCallStack = [], now = Date.now()) {
    if (!targetRole) {
      return { allowed: false, state: CircuitState.CLOSED, reason: 'ERR_INVALID_ROLE' };
    }

    // 1. Check recursion call stack depth
    if (currentCallStack.length >= this.maxCallDepth) {
      return {
        allowed: false,
        state: CircuitState.CLOSED,
        reason: 'ERR_MAX_CALL_DEPTH_EXCEEDED',
      };
    }

    // 2. Check for direct cycle in call stack (A -> B -> A)
    if (currentCallStack.includes(targetRole)) {
      return {
        allowed: false,
        state: CircuitState.CLOSED,
        reason: 'ERR_CIRCULAR_DELEGATION_DETECTED',
      };
    }

    const state = this._getRoleState(targetRole);

    // Check cooldown for OPEN state
    if (state.state === CircuitState.OPEN && now - state.tripTime >= this.cooldownPeriodMs) {
      state.state = CircuitState.HALF_OPEN;
      state.consecutiveSuccesses = 0;
    }

    if (state.state === CircuitState.OPEN) {
      return {
        allowed: false,
        state: state.state,
        reason: 'ERR_SUBAGENT_CIRCUIT_OPEN',
      };
    }

    return {
      allowed: true,
      state: state.state,
    };
  }

  /**
   * Records execution outcome of a subagent call.
   */
  recordOutcome(targetRole, success, now = Date.now()) {
    const state = this._getRoleState(targetRole);

    if (success) {
      if (state.state === CircuitState.HALF_OPEN) {
        state.consecutiveSuccesses++;
        if (state.consecutiveSuccesses >= this.recoverySuccessThreshold) {
          state.state = CircuitState.CLOSED;
          state.consecutiveFailures = 0;
        }
      } else {
        state.consecutiveFailures = 0;
      }
    } else {
      state.consecutiveFailures++;
      state.consecutiveSuccesses = 0;

      if (state.state === CircuitState.HALF_OPEN || state.consecutiveFailures >= this.failureThreshold) {
        state.state = CircuitState.OPEN;
        state.tripTime = now;
      }
    }
  }

  reset(role) {
    if (role) {
      this.roleStates.delete(role);
    } else {
      this.roleStates.clear();
    }
  }
}
