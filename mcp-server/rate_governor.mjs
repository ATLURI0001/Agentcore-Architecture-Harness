// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
// Multi-Tenant Session Rate Governor & Leaky Bucket Token Flow Controller.

/**
 * Token Bucket implementation for rate limiting bursty request streams.
 */
export class TokenBucket {
  /**
   * @param {number} capacity - Maximum burst token capacity (C)
   * @param {number} refillRate - Refill rate in tokens per second (r)
   * @param {number} [initialTokens] - Starting token level (defaults to capacity)
   */
  constructor(capacity, refillRate, initialTokens = null) {
    if (capacity <= 0 || !Number.isFinite(capacity)) {
      throw new Error(`Invalid capacity: ${capacity}. Must be positive finite number.`);
    }
    if (refillRate <= 0 || !Number.isFinite(refillRate)) {
      throw new Error(`Invalid refillRate: ${refillRate}. Must be positive finite number.`);
    }

    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = initialTokens !== null ? Math.min(capacity, Math.max(0, initialTokens)) : capacity;
    this.lastRefill = Date.now();
  }

  /**
   * Refill tokens based on elapsed wall-clock time.
   * @param {number} [now]
   * @returns {number} Current available tokens
   */
  refill(now = Date.now()) {
    const elapsedSeconds = Math.max(0, (now - this.lastRefill) / 1000);
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillRate);
    this.lastRefill = now;
    return this.tokens;
  }

  /**
   * Attempt to consume tokens.
   * @param {number} cost - Number of tokens to consume
   * @param {number} [now]
   * @returns {{ allowed: boolean, remaining: number, waitTimeMs: number }}
   */
  consume(cost = 1.0, now = Date.now()) {
    if (cost <= 0) return { allowed: true, remaining: this.tokens, waitTimeMs: 0 };
    this.refill(now);

    if (this.tokens >= cost) {
      this.tokens -= cost;
      return {
        allowed: true,
        remaining: Math.round(this.tokens * 1e4) / 1e4,
        waitTimeMs: 0,
      };
    }

    const deficit = cost - this.tokens;
    const waitTimeMs = Math.ceil((deficit / this.refillRate) * 1000);
    return {
      allowed: false,
      remaining: Math.round(this.tokens * 1e4) / 1e4,
      waitTimeMs,
    };
  }
}

/**
 * Leaky Bucket implementation for smooth rate shaping and queue overflow protection.
 */
export class LeakyBucketFlow {
  /**
   * @param {number} capacity - Maximum buffer capacity in units
   * @param {number} leakRate - Drain rate in units per second
   */
  constructor(capacity, leakRate) {
    if (capacity <= 0 || !Number.isFinite(capacity)) {
      throw new Error(`Invalid capacity: ${capacity}. Must be positive finite number.`);
    }
    if (leakRate <= 0 || !Number.isFinite(leakRate)) {
      throw new Error(`Invalid leakRate: ${leakRate}. Must be positive finite number.`);
    }

    this.capacity = capacity;
    this.leakRate = leakRate;
    this.level = 0.0;
    this.lastLeak = Date.now();
  }

  /**
   * Drain bucket based on elapsed time.
   * @param {number} [now]
   * @returns {number} Current water level
   */
  drain(now = Date.now()) {
    const elapsedSeconds = Math.max(0, (now - this.lastLeak) / 1000);
    this.level = Math.max(0, this.level - elapsedSeconds * this.leakRate);
    this.lastLeak = now;
    return this.level;
  }

  /**
   * Attempt to push flow units into the leaky bucket.
   * @param {number} units - Work units to add
   * @param {number} [now]
   * @returns {{ dropped: boolean, level: number, queueDelayMs: number, overflow: number }}
   */
  push(units = 1.0, now = Date.now()) {
    if (units <= 0) return { dropped: false, level: this.level, queueDelayMs: 0, overflow: 0 };
    this.drain(now);

    if (this.level + units <= this.capacity) {
      this.level += units;
      const queueDelayMs = Math.round((this.level / this.leakRate) * 1000);
      return {
        dropped: false,
        level: Math.round(this.level * 1e4) / 1e4,
        queueDelayMs,
        overflow: 0,
      };
    }

    const overflow = Math.round((this.level + units - this.capacity) * 1e4) / 1e4;
    return {
      dropped: true,
      level: Math.round(this.level * 1e4) / 1e4,
      queueDelayMs: Math.round((this.level / this.leakRate) * 1000),
      overflow,
    };
  }
}

/**
 * Multi-Tenant Session Rate Governor orchestrating isolated token and leaky buckets.
 */
export class SessionRateGovernor {
  /**
   * @param {object} [options]
   * @param {number} [options.burstCapacity=30] - Max burst tokens per session
   * @param {number} [options.refillRate=5] - Refill tokens/sec per session
   * @param {number} [options.bufferCapacity=100] - Leaky bucket queue capacity
   * @param {number} [options.leakRate=10] - Drain rate units/sec
   * @param {number} [options.idleTtlMs=3600000] - Eviction TTL for inactive sessions (1 hour)
   * @param {number} [options.maxSessions=10000] - Hard cap on tracked active sessions
   */
  constructor(options = {}) {
    this.burstCapacity = options.burstCapacity ?? 30;
    this.refillRate = options.refillRate ?? 5;
    this.bufferCapacity = options.bufferCapacity ?? 100;
    this.leakRate = options.leakRate ?? 10;
    this.idleTtlMs = options.idleTtlMs ?? 3600000;
    this.maxSessions = options.maxSessions ?? 10000;

    /** @type {Map<string, { tokenBucket: TokenBucket, leakyBucket: LeakyBucketFlow, lastSeen: number, stats: object }>} */
    this.sessions = new Map();

    this.globalStats = {
      admitted: 0,
      throttled: 0,
      evicted: 0,
      totalTokensConsumed: 0,
    };
  }

  /**
   * Retrieve or initialize state for a session.
   * @private
   */
  _getSession(sessionId, now) {
    let session = this.sessions.get(sessionId);
    if (!session) {
      if (this.sessions.size >= this.maxSessions) {
        this.cleanupIdleSessions(now);
        if (this.sessions.size >= this.maxSessions) {
          throw new Error(`Rate governor session capacity exceeded (${this.maxSessions})`);
        }
      }
      session = {
        tokenBucket: new TokenBucket(this.burstCapacity, this.refillRate),
        leakyBucket: new LeakyBucketFlow(this.bufferCapacity, this.leakRate),
        lastSeen: now,
        stats: {
          admitted: 0,
          throttled: 0,
          tokensConsumed: 0,
        },
      };
      this.sessions.set(sessionId, session);
    }
    session.lastSeen = now;
    return session;
  }

  /**
   * Evaluate whether a session request should be admitted.
   * @param {string} sessionId
   * @param {number} [tokenCost=1.0]
   * @param {number} [now=Date.now()]
   * @returns {{ admitted: boolean, remaining: number, waitTimeMs: number, queueDelayMs: number }}
   */
  evaluate(sessionId, tokenCost = 1.0, now = Date.now()) {
    if (!sessionId || typeof sessionId !== "string") {
      throw new Error("Invalid sessionId: must be non-empty string");
    }

    const session = this._getSession(sessionId, now);
    const tokenResult = session.tokenBucket.consume(tokenCost, now);

    if (!tokenResult.allowed) {
      this.globalStats.throttled++;
      session.stats.throttled++;
      return {
        admitted: false,
        remaining: tokenResult.remaining,
        waitTimeMs: tokenResult.waitTimeMs,
        queueDelayMs: Math.round((session.leakyBucket.drain(now) / this.leakRate) * 1000),
      };
    }

    const flowResult = session.leakyBucket.push(tokenCost, now);
    if (flowResult.dropped) {
      // Rollback consumed token due to queue overflow
      session.tokenBucket.tokens = Math.min(session.tokenBucket.capacity, session.tokenBucket.tokens + tokenCost);
      this.globalStats.throttled++;
      session.stats.throttled++;
      return {
        admitted: false,
        remaining: session.tokenBucket.tokens,
        waitTimeMs: Math.ceil((flowResult.overflow / this.leakRate) * 1000),
        queueDelayMs: flowResult.queueDelayMs,
      };
    }

    this.globalStats.admitted++;
    this.globalStats.totalTokensConsumed += tokenCost;
    session.stats.admitted++;
    session.stats.tokensConsumed += tokenCost;

    return {
      admitted: true,
      remaining: tokenResult.remaining,
      waitTimeMs: 0,
      queueDelayMs: flowResult.queueDelayMs,
    };
  }

  /**
   * Periodic sweep to garbage collect dead sessions.
   * @param {number} [now=Date.now()]
   * @returns {number} Number of evicted sessions
   */
  cleanupIdleSessions(now = Date.now()) {
    let evictedCount = 0;
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastSeen > this.idleTtlMs) {
        this.sessions.delete(id);
        evictedCount++;
      }
    }
    this.globalStats.evicted += evictedCount;
    return evictedCount;
  }

  /**
   * Reset session state or delete it.
   * @param {string} sessionId
   */
  resetSession(sessionId) {
    this.sessions.delete(sessionId);
  }

  /**
   * Retrieve aggregate governor metrics.
   */
  getDiagnostics() {
    return {
      activeSessions: this.sessions.size,
      globalStats: { ...this.globalStats },
      config: {
        burstCapacity: this.burstCapacity,
        refillRate: this.refillRate,
        bufferCapacity: this.bufferCapacity,
        leakRate: this.leakRate,
        idleTtlMs: this.idleTtlMs,
      },
    };
  }
}
