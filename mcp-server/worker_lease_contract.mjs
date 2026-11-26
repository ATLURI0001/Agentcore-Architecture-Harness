/**
 * Agentcore - Distributed Worker Lease Contract & Heartbeat Invariant Manager.
 *
 * Enforces formal lease grants, renewals, timeouts, heartbeat monotonicity,
 * and zombie worker eviction boundaries for multi-agent execution harnesses.
 */

import { createHmac, randomBytes } from 'node:crypto';

export const LEASE_STATES = Object.freeze({
  ACQUIRED: 'ACQUIRED',
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  RELEASED: 'RELEASED',
  REVOKED: 'REVOKED',
});

export const WORKER_ID_REGEX = /^worker-[a-zA-Z0-9_-]{2,32}$/;
export const TASK_ID_REGEX = /^task-[a-zA-Z0-9_-]{4,64}$/;

const DEFAULT_SECRET = 'agentcore-lease-secret-key-9912';

export class WorkerLeaseContractError extends Error {
  constructor(message, code, field = null) {
    super(`[WorkerLeaseContract][${code}] ${message}`);
    this.name = 'WorkerLeaseContractError';
    this.code = code;
    this.field = field;
  }
}

/**
 * WorkerLeaseContract enforces rigid operational boundaries on worker leases.
 */
export class WorkerLeaseContract {
  constructor(options = {}) {
    this.minLeaseDurationMs = options.minLeaseDurationMs ?? 2000;
    this.maxLeaseDurationMs = options.maxLeaseDurationMs ?? 300000; // 5 min max
    this.heartbeatGracePeriodMs = options.heartbeatGracePeriodMs ?? 3000;
    this.secret = options.secret ?? DEFAULT_SECRET;

    // taskId -> lease record
    this._leases = new Map();
    // workerId -> Set of active taskIds
    this._workerTasks = new Map();
  }

  _generateToken(leaseId, workerId, taskId, expiresAt) {
    const payload = `${leaseId}:${workerId}:${taskId}:${expiresAt}`;
    return createHmac('sha256', this.secret).update(payload).digest('hex');
  }

  _verifyToken(lease, token) {
    const expected = this._generateToken(lease.leaseId, lease.workerId, lease.taskId, lease.expiresAt);
    return token === expected;
  }

  /**
   * Acquires a lease on a task for a specified worker.
   */
  acquireLease({ workerId, taskId, durationMs = 30000, maxWorkerConcurrency = 10, now = Date.now() }) {
    if (!workerId || typeof workerId !== 'string' || !WORKER_ID_REGEX.test(workerId)) {
      throw new WorkerLeaseContractError(
        `Invalid workerId format: '${workerId}'. Must match ${WORKER_ID_REGEX}`,
        'ERR_INVALID_WORKER_ID',
        'workerId'
      );
    }

    if (!taskId || typeof taskId !== 'string' || !TASK_ID_REGEX.test(taskId)) {
      throw new WorkerLeaseContractError(
        `Invalid taskId format: '${taskId}'. Must match ${TASK_ID_REGEX}`,
        'ERR_INVALID_TASK_ID',
        'taskId'
      );
    }

    if (durationMs < this.minLeaseDurationMs || durationMs > this.maxLeaseDurationMs) {
      throw new WorkerLeaseContractError(
        `Lease duration ${durationMs}ms is outside permissible range [${this.minLeaseDurationMs}..${this.maxLeaseDurationMs}]`,
        'ERR_DURATION_OUT_OF_BOUNDS',
        'durationMs'
      );
    }

    // Check if task is already leased and not expired
    const existing = this._leases.get(taskId);
    if (existing && (existing.state === LEASE_STATES.ACQUIRED || existing.state === LEASE_STATES.ACTIVE)) {
      if (now < existing.expiresAt) {
        throw new WorkerLeaseContractError(
          `Task '${taskId}' is actively leased to worker '${existing.workerId}' until timestamp ${existing.expiresAt}`,
          'ERR_TASK_ALREADY_LEASED',
          'taskId'
        );
      } else {
        // Expired lease: Mark expired and evict
        existing.state = LEASE_STATES.EXPIRED;
        this._removeWorkerTask(existing.workerId, taskId);
      }
    }

    // Check worker concurrency limit
    const currentTasks = this._workerTasks.get(workerId) || new Set();
    if (currentTasks.size >= maxWorkerConcurrency) {
      throw new WorkerLeaseContractError(
        `Worker '${workerId}' has reached maximum concurrent lease limit of ${maxWorkerConcurrency}`,
        'ERR_WORKER_CONCURRENCY_EXCEEDED',
        'workerId'
      );
    }

    const leaseId = `lease-${randomBytes(8).toString('hex')}`;
    const expiresAt = now + durationMs;
    const token = this._generateToken(leaseId, workerId, taskId, expiresAt);

    const record = {
      leaseId,
      workerId,
      taskId,
      state: LEASE_STATES.ACQUIRED,
      grantedAt: now,
      expiresAt,
      lastHeartbeatAt: now,
      heartbeatSequence: 0,
      token,
      renewalCount: 0,
    };

    this._leases.set(taskId, record);
    if (!this._workerTasks.has(workerId)) {
      this._workerTasks.set(workerId, new Set());
    }
    this._workerTasks.get(workerId).add(taskId);

    return { ...record };
  }

  /**
   * Heartbeat to extend or maintain worker lease. Enforces monotonic heartbeat sequence.
   */
  heartbeat({ taskId, workerId, token, sequence, extendMs = 0, now = Date.now() }) {
    const lease = this._leases.get(taskId);
    if (!lease) {
      throw new WorkerLeaseContractError(`No lease found for task '${taskId}'`, 'ERR_LEASE_NOT_FOUND', 'taskId');
    }

    if (lease.workerId !== workerId) {
      throw new WorkerLeaseContractError(
        `Worker '${workerId}' does not own lease for task '${taskId}' (owned by '${lease.workerId}')`,
        'ERR_WORKER_MISMATCH',
        'workerId'
      );
    }

    if (lease.state !== LEASE_STATES.ACQUIRED && lease.state !== LEASE_STATES.ACTIVE) {
      throw new WorkerLeaseContractError(
        `Cannot heartbeat lease in '${lease.state}' state`,
        'ERR_INVALID_LEASE_STATE',
        'state'
      );
    }

    // Check expiration with grace period
    if (now > lease.expiresAt + this.heartbeatGracePeriodMs) {
      lease.state = LEASE_STATES.EXPIRED;
      this._removeWorkerTask(workerId, taskId);
      throw new WorkerLeaseContractError(
        `Lease for task '${taskId}' has expired at ${lease.expiresAt}`,
        'ERR_LEASE_EXPIRED',
        'taskId'
      );
    }

    // Verify token cryptographic signature
    if (!this._verifyToken(lease, token)) {
      throw new WorkerLeaseContractError('Lease cryptographic verification token is invalid', 'ERR_INVALID_TOKEN', 'token');
    }

    // Enforce monotonic heartbeat sequence invariant
    if (sequence <= lease.heartbeatSequence) {
      throw new WorkerLeaseContractError(
        `Heartbeat sequence must be strictly greater than last observed (${lease.heartbeatSequence}), got ${sequence}`,
        'ERR_NON_MONOTONIC_SEQUENCE',
        'sequence'
      );
    }

    lease.heartbeatSequence = sequence;
    lease.lastHeartbeatAt = now;
    lease.state = LEASE_STATES.ACTIVE;

    if (extendMs > 0) {
      if (extendMs < this.minLeaseDurationMs || extendMs > this.maxLeaseDurationMs) {
        throw new WorkerLeaseContractError(
          `Extension duration ${extendMs}ms out of bounds [${this.minLeaseDurationMs}..${this.maxLeaseDurationMs}]`,
          'ERR_EXTENSION_OUT_OF_BOUNDS',
          'extendMs'
        );
      }
      lease.expiresAt = now + extendMs;
      lease.renewalCount += 1;
      // Re-sign token with new expiresAt
      lease.token = this._generateToken(lease.leaseId, lease.workerId, lease.taskId, lease.expiresAt);
    }

    return { ...lease };
  }

  /**
   * Releases lease upon task completion or cancellation.
   */
  releaseLease({ taskId, workerId, token }) {
    const lease = this._leases.get(taskId);
    if (!lease) {
      throw new WorkerLeaseContractError(`No lease found for task '${taskId}'`, 'ERR_LEASE_NOT_FOUND', 'taskId');
    }

    if (lease.workerId !== workerId) {
      throw new WorkerLeaseContractError('Worker ID mismatch during release', 'ERR_WORKER_MISMATCH', 'workerId');
    }

    if (!this._verifyToken(lease, token)) {
      throw new WorkerLeaseContractError('Invalid token on release', 'ERR_INVALID_TOKEN', 'token');
    }

    lease.state = LEASE_STATES.RELEASED;
    this._removeWorkerTask(workerId, taskId);
    return { ...lease };
  }

  /**
   * Evicts expired or zombie leases older than current time.
   */
  reclaimExpiredLeases(now = Date.now()) {
    const reclaimed = [];
    for (const [taskId, lease] of this._leases.entries()) {
      if (
        (lease.state === LEASE_STATES.ACQUIRED || lease.state === LEASE_STATES.ACTIVE) &&
        now > lease.expiresAt + this.heartbeatGracePeriodMs
      ) {
        lease.state = LEASE_STATES.EXPIRED;
        this._removeWorkerTask(lease.workerId, taskId);
        reclaimed.push(taskId);
      }
    }
    return reclaimed;
  }

  getLease(taskId) {
    const lease = this._leases.get(taskId);
    return lease ? { ...lease } : null;
  }

  _removeWorkerTask(workerId, taskId) {
    const tasks = this._workerTasks.get(workerId);
    if (tasks) {
      tasks.delete(taskId);
      if (tasks.size === 0) {
        this._workerTasks.delete(workerId);
      }
    }
  }
}
