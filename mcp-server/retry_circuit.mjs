// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
// Asynchronous RPC Exponential Backoff, AWS Full/Decorrelated Jitter & Circuit Failsafe.

/**
 * Standard retryable HTTP status codes and node error codes.
 */
export const DEFAULT_RETRYABLE_ERRORS = new Set([
  429, // Too Many Requests
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "ECONNREFUSED",
]);

/**
 * Calculates exponential backoff delay with AWS Full Jitter.
 * Formula: sleep = random_between(0, min(maxDelay, baseDelay * 2^attempt))
 */
export function calculateFullJitterDelay(attempt, baseDelayMs = 100, maxDelayMs = 10000, randomFn = Math.random) {
  if (attempt < 0) attempt = 0;
  const temp = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
  const sleep = randomFn() * temp;
  return Math.round(sleep);
}

/**
 * Calculates backoff delay with AWS Decorrelated Jitter.
 * Formula: sleep = min(maxDelay, random_between(baseDelay, previousSleep * 3))
 */
export function calculateDecorrelatedJitterDelay(previousSleepMs, baseDelayMs = 100, maxDelayMs = 10000, randomFn = Math.random) {
  const low = baseDelayMs;
  const high = Math.max(baseDelayMs, previousSleepMs * 3);
  const sleep = Math.min(maxDelayMs, low + randomFn() * (high - low));
  return Math.round(sleep);
}

/**
 * Evaluates whether an error object is transient and retryable.
 */
export function isRetryableError(err, customRetryableCodes = DEFAULT_RETRYABLE_ERRORS) {
  if (!err) return false;

  // Check HTTP status
  const status = err.status ?? err.statusCode;
  if (status && customRetryableCodes.has(Number(status))) {
    return true;
  }

  // Check system errno
  const code = err.code;
  if (code && customRetryableCodes.has(code)) {
    return true;
  }

  return false;
}

/**
 * Circuit Failsafe state machine preventing cascade failures.
 */
export class CircuitFailsafe {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.cooldownMs = options.cooldownMs ?? 15000;
    this.halfOpenCanaryCount = options.halfOpenCanaryCount ?? 2;

    this.state = "CLOSED"; // CLOSED | OPEN | HALF_OPEN
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = 0;
  }

  /**
   * Checks if an execution is permitted under current circuit state.
   */
  allowRequest(now = Date.now()) {
    if (this.state === "CLOSED") {
      return true;
    }

    if (this.state === "OPEN") {
      if (now - this.lastFailureTime >= this.cooldownMs) {
        this.state = "HALF_OPEN";
        this.consecutiveSuccesses = 0;
        return true; // Allow canary probe
      }
      return false; // Fast fail
    }

    // HALF_OPEN: allow limited canary requests
    return true;
  }

  recordSuccess() {
    if (this.state === "HALF_OPEN") {
      this.consecutiveSuccesses++;
      if (this.consecutiveSuccesses >= this.halfOpenCanaryCount) {
        this.state = "CLOSED";
        this.consecutiveFailures = 0;
      }
    } else if (this.state === "CLOSED") {
      this.consecutiveFailures = 0;
    }
  }

  recordFailure(now = Date.now()) {
    this.lastFailureTime = now;
    this.consecutiveSuccesses = 0;
    this.consecutiveFailures++;

    if (this.state === "HALF_OPEN" || this.consecutiveFailures >= this.failureThreshold) {
      this.state = "OPEN";
    }
  }

  reset() {
    this.state = "CLOSED";
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = 0;
  }
}

/**
 * Executes an asynchronous function with full jitter exponential backoff and circuit protection.
 */
export async function executeWithRetry(fn, options = {}) {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 50;
  const maxDelayMs = options.maxDelayMs ?? 5000;
  const circuit = options.circuit ?? null;
  const sleepFn = options.sleepFn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (circuit && !circuit.allowRequest()) {
      throw new Error(`Circuit open: execution fast-failed on attempt ${attempt + 1}`);
    }

    try {
      const result = await fn(attempt);
      if (circuit) circuit.recordSuccess();
      return result;
    } catch (err) {
      lastError = err;
      if (circuit) circuit.recordFailure();

      const isRetryable = isRetryableError(err, options.retryableCodes);
      const isLastAttempt = attempt === maxAttempts - 1;

      if (!isRetryable || isLastAttempt) {
        throw err;
      }

      const delayMs = calculateFullJitterDelay(attempt, baseDelayMs, maxDelayMs);
      await sleepFn(delayMs);
    }
  }

  throw lastError;
}
