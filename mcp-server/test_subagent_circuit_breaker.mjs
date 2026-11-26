import assert from 'node:assert/strict';
import { SubagentCircuitBreaker, CircuitState } from './subagent_circuit_breaker.mjs';

function runTests() {
  console.log('Running SubagentCircuitBreaker tests...');

  // Test 1: Normal invocation
  {
    const cb = new SubagentCircuitBreaker();
    const res = cb.canInvoke('code_reviewer', ['coordinator']);
    assert.equal(res.allowed, true);
    assert.equal(res.state, CircuitState.CLOSED);
  }

  // Test 2: Max call depth exceeded
  {
    const cb = new SubagentCircuitBreaker({ maxCallDepth: 3 });
    const stack = ['agent1', 'agent2', 'agent3'];
    const res = cb.canInvoke('agent4', stack);
    assert.equal(res.allowed, false);
    assert.equal(res.reason, 'ERR_MAX_CALL_DEPTH_EXCEEDED');
  }

  // Test 3: Circular delegation detected
  {
    const cb = new SubagentCircuitBreaker();
    const stack = ['coordinator', 'planner', 'coder'];
    const res = cb.canInvoke('planner', stack);
    assert.equal(res.allowed, false);
    assert.equal(res.reason, 'ERR_CIRCULAR_DELEGATION_DETECTED');
  }

  // Test 4: Consecutive failures trip circuit
  {
    const cb = new SubagentCircuitBreaker({ failureThreshold: 2, cooldownPeriodMs: 500 });
    const t0 = 1000;

    cb.recordOutcome('flaky_worker', false, t0);
    assert.equal(cb.canInvoke('flaky_worker', [], t0).allowed, true);

    cb.recordOutcome('flaky_worker', false, t0 + 10);
    const resTrip = cb.canInvoke('flaky_worker', [], t0 + 20);
    assert.equal(resTrip.allowed, false);
    assert.equal(resTrip.state, CircuitState.OPEN);
    assert.equal(resTrip.reason, 'ERR_SUBAGENT_CIRCUIT_OPEN');

    // After cooldown -> HALF_OPEN
    const resHalf = cb.canInvoke('flaky_worker', [], t0 + 600);
    assert.equal(resHalf.allowed, true);
    assert.equal(resHalf.state, CircuitState.HALF_OPEN);

    // 2 successes -> CLOSED
    cb.recordOutcome('flaky_worker', true, t0 + 610);
    cb.recordOutcome('flaky_worker', true, t0 + 620);
    const resClosed = cb.canInvoke('flaky_worker', [], t0 + 630);
    assert.equal(resClosed.allowed, true);
    assert.equal(resClosed.state, CircuitState.CLOSED);
  }

  console.log('All SubagentCircuitBreaker tests passed successfully!');
}

runTests();
