// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
// Unit tests for retry_circuit, jitter calculations, and circuit failsafe.

import assert from "node:assert/strict";
import {
  calculateFullJitterDelay,
  calculateDecorrelatedJitterDelay,
  isRetryableError,
  CircuitFailsafe,
  executeWithRetry,
} from "./retry_circuit.mjs";

console.log("running retry_circuit unit tests...");

// Test 1: Full jitter delay boundaries
{
  // With random = 0.5: attempt 0 -> 0.5 * min(1000, 100 * 2^0) = 50ms
  const d0 = calculateFullJitterDelay(0, 100, 1000, () => 0.5);
  assert.equal(d0, 50);

  // Attempt 2 -> 0.5 * min(1000, 100 * 4) = 200ms
  const d2 = calculateFullJitterDelay(2, 100, 1000, () => 0.5);
  assert.equal(d2, 200);

  // Clamped by maxDelay
  const dMax = calculateFullJitterDelay(10, 100, 1000, () => 1.0);
  assert.equal(dMax, 1000);
  console.log("ok   calculateFullJitterDelay adheres to exponential bounds and ceiling");
}

// Test 2: Decorrelated jitter calculation
{
  // low = 50, high = max(50, 100 * 3) = 300. With r=0.5: 50 + 0.5 * 250 = 175ms
  const d = calculateDecorrelatedJitterDelay(100, 50, 2000, () => 0.5);
  assert.equal(d, 175);
  console.log("ok   calculateDecorrelatedJitterDelay expands delay decorrelated from previous sleep");
}

// Test 3: isRetryableError classification
{
  assert.equal(isRetryableError({ status: 429 }), true);
  assert.equal(isRetryableError({ statusCode: 503 }), true);
  assert.equal(isRetryableError({ code: "ECONNRESET" }), true);
  assert.equal(isRetryableError({ status: 400 }), false);
  assert.equal(isRetryableError({ status: 404 }), false);
  assert.equal(isRetryableError(null), false);
  console.log("ok   isRetryableError identifies transient vs permanent failures");
}

// Test 4: CircuitFailsafe transitions
{
  const circuit = new CircuitFailsafe({
    failureThreshold: 2,
    cooldownMs: 1000,
    halfOpenCanaryCount: 2,
  });

  const t0 = 10000;
  assert.equal(circuit.allowRequest(t0), true);

  // Failure 1
  circuit.recordFailure(t0);
  assert.equal(circuit.state, "CLOSED");

  // Failure 2 -> TRIPS
  circuit.recordFailure(t0);
  assert.equal(circuit.state, "OPEN");

  // Immediate request -> rejected
  assert.equal(circuit.allowRequest(t0 + 500), false);

  // After cooldown (1000ms) -> transitions to HALF_OPEN canary probe
  assert.equal(circuit.allowRequest(t0 + 1500), true);
  assert.equal(circuit.state, "HALF_OPEN");

  // 2 consecutive canary successes -> CLOSED
  circuit.recordSuccess();
  circuit.recordSuccess();
  assert.equal(circuit.state, "CLOSED");
  console.log("ok   CircuitFailsafe closed/open/half-open state machine");
}

// Test 5: executeWithRetry execution flow
{
  let callCount = 0;
  const mockSleep = async () => {};

  // Flaky function: fails once with 503, then succeeds on 2nd attempt
  const flakyFn = async () => {
    callCount++;
    if (callCount === 1) {
      const err = new Error("Service Unavailable");
      err.status = 503;
      throw err;
    }
    return "SUCCESS_PAYLOAD";
  };

  const res = await executeWithRetry(flakyFn, {
    maxAttempts: 3,
    sleepFn: mockSleep,
  });

  assert.equal(res, "SUCCESS_PAYLOAD");
  assert.equal(callCount, 2);
  console.log("ok   executeWithRetry recovers transient failures");
}

console.log("all retry_circuit unit tests passed successfully!");
