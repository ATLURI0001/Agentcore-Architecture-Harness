// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
// Unit tests for SessionRateGovernor and Token/Leaky Buckets.

import assert from "node:assert/strict";
import { TokenBucket, LeakyBucketFlow, SessionRateGovernor } from "./rate_governor.mjs";

console.log("running rate_governor unit tests...");

// Test 1: TokenBucket initialization and basic consumption
{
  const tb = new TokenBucket(10, 2);
  const res1 = tb.consume(4);
  assert.equal(res1.allowed, true);
  assert.equal(res1.remaining, 6);
  assert.equal(res1.waitTimeMs, 0);

  const res2 = tb.consume(6);
  assert.equal(res2.allowed, true);
  assert.equal(res2.remaining, 0);

  const res3 = tb.consume(1);
  assert.equal(res3.allowed, false);
  assert.ok(res3.waitTimeMs > 0);
  console.log("ok   TokenBucket basic consume and exhaustion");
}

// Test 2: TokenBucket refill over synthetic time
{
  const tb = new TokenBucket(10, 5, 0); // 0 initial tokens, 5 tokens/sec
  const t0 = 1000000;
  tb.lastRefill = t0;

  // Check before time passes
  assert.equal(tb.consume(1, t0).allowed, false);

  // Advance 1.0 second -> 5 tokens generated
  const res = tb.consume(3, t0 + 1000);
  assert.equal(res.allowed, true);
  assert.equal(res.remaining, 2);

  // Advance 10 seconds -> should cap at capacity 10
  tb.refill(t0 + 11000);
  assert.equal(tb.tokens, 10);
  console.log("ok   TokenBucket time-based refill and capacity ceiling");
}

// Test 3: LeakyBucketFlow queuing and overflow
{
  const lb = new LeakyBucketFlow(10, 2); // capacity 10 units, 2 units/sec leak
  const t0 = 1000000;
  lb.lastLeak = t0;

  const push1 = lb.push(6, t0);
  assert.equal(push1.dropped, false);
  assert.equal(push1.level, 6);
  assert.equal(push1.queueDelayMs, 3000); // 6 / 2 * 1000 = 3000ms

  // Advance 2 seconds -> drained 4 units -> level 2
  const push2 = lb.push(5, t0 + 2000);
  assert.equal(push2.dropped, false);
  assert.equal(push2.level, 7); // (6 - 4) + 5 = 7

  // Push 5 more -> exceeds 10 -> dropped
  const push3 = lb.push(5, t0 + 2000);
  assert.equal(push3.dropped, true);
  assert.equal(push3.overflow, 2); // 7 + 5 - 10 = 2
  console.log("ok   LeakyBucketFlow drain, queue delay, and drop calculation");
}

// Test 4: SessionRateGovernor multi-tenant isolation
{
  const governor = new SessionRateGovernor({
    burstCapacity: 5,
    refillRate: 1,
    bufferCapacity: 20,
    leakRate: 5,
    idleTtlMs: 5000,
  });

  const t0 = 2000000;

  // Session A consumes its entire burst quota
  for (let i = 0; i < 5; i++) {
    const res = governor.evaluate("session-A", 1, t0);
    assert.equal(res.admitted, true);
  }

  // 6th request from session-A is throttled
  const throttledA = governor.evaluate("session-A", 1, t0);
  assert.equal(throttledA.admitted, false);
  assert.ok(throttledA.waitTimeMs > 0);

  // Session B is completely isolated and admitted
  const resB = governor.evaluate("session-B", 1, t0);
  assert.equal(resB.admitted, true);
  assert.equal(resB.remaining, 4);

  console.log("ok   SessionRateGovernor multi-tenant session isolation");
}

// Test 5: SessionRateGovernor idle cleanup and diagnostics
{
  const governor = new SessionRateGovernor({
    idleTtlMs: 2000,
  });

  const t0 = 3000000;
  governor.evaluate("session-1", 1, t0);
  governor.evaluate("session-2", 1, t0 + 1000);

  assert.equal(governor.sessions.size, 2);

  // Sweep at t0 + 2500 -> session-1 idle for 2500ms (>2000ms), session-2 idle for 1500ms
  const evicted = governor.cleanupIdleSessions(t0 + 2500);
  assert.equal(evicted, 1);
  assert.equal(governor.sessions.has("session-1"), false);
  assert.equal(governor.sessions.has("session-2"), true);

  const diag = governor.getDiagnostics();
  assert.equal(diag.activeSessions, 1);
  assert.equal(diag.globalStats.evicted, 1);
  assert.equal(diag.globalStats.admitted, 2);
  console.log("ok   SessionRateGovernor idle eviction and telemetry diagnostics");
}

console.log("all rate_governor unit tests passed successfully!");
