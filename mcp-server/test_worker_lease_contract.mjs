import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WorkerLeaseContract,
  WorkerLeaseContractError,
  LEASE_STATES,
} from './worker_lease_contract.mjs';

test('WorkerLeaseContract: acquires compliant lease with cryptographic token', () => {
  const manager = new WorkerLeaseContract();
  const t0 = 100000;

  const lease = manager.acquireLease({
    workerId: 'worker-executor-01',
    taskId: 'task-build-assets-99',
    durationMs: 10000,
    now: t0,
  });

  assert.equal(lease.workerId, 'worker-executor-01');
  assert.equal(lease.taskId, 'task-build-assets-99');
  assert.equal(lease.state, LEASE_STATES.ACQUIRED);
  assert.equal(lease.expiresAt, t0 + 10000);
  assert.equal(typeof lease.token, 'string');
  assert.equal(lease.token.length, 64); // sha256 hex
});

test('WorkerLeaseContract: rejects invalid IDs and out-of-bounds duration', () => {
  const manager = new WorkerLeaseContract();

  // Invalid worker ID
  assert.throws(
    () => manager.acquireLease({ workerId: 'bad_worker', taskId: 'task-1234' }),
    (err) => err instanceof WorkerLeaseContractError && err.code === 'ERR_INVALID_WORKER_ID'
  );

  // Invalid task ID
  assert.throws(
    () => manager.acquireLease({ workerId: 'worker-01', taskId: 'tsk' }),
    (err) => err instanceof WorkerLeaseContractError && err.code === 'ERR_INVALID_TASK_ID'
  );

  // Duration too small
  assert.throws(
    () => manager.acquireLease({ workerId: 'worker-01', taskId: 'task-1234', durationMs: 500 }),
    (err) => err instanceof WorkerLeaseContractError && err.code === 'ERR_DURATION_OUT_OF_BOUNDS'
  );
});

test('WorkerLeaseContract: prevents double leasing and enforces concurrency caps', () => {
  const manager = new WorkerLeaseContract();
  const t0 = 100000;

  manager.acquireLease({
    workerId: 'worker-01',
    taskId: 'task-job-1111',
    durationMs: 5000,
    maxWorkerConcurrency: 2,
    now: t0,
  });

  // Re-acquire same task before expiration -> throws
  assert.throws(
    () =>
      manager.acquireLease({
        workerId: 'worker-02',
        taskId: 'task-job-1111',
        now: t0 + 1000,
      }),
    (err) => err instanceof WorkerLeaseContractError && err.code === 'ERR_TASK_ALREADY_LEASED'
  );

  // Second task for worker-01 -> succeeds
  manager.acquireLease({
    workerId: 'worker-01',
    taskId: 'task-job-2222',
    durationMs: 5000,
    maxWorkerConcurrency: 2,
    now: t0,
  });

  // Third task for worker-01 -> exceeds concurrency limit of 2
  assert.throws(
    () =>
      manager.acquireLease({
        workerId: 'worker-01',
        taskId: 'task-job-3333',
        durationMs: 5000,
        maxWorkerConcurrency: 2,
        now: t0,
      }),
    (err) => err instanceof WorkerLeaseContractError && err.code === 'ERR_WORKER_CONCURRENCY_EXCEEDED'
  );
});

test('WorkerLeaseContract: heartbeat enforces monotonic sequence and extends lease', () => {
  const manager = new WorkerLeaseContract();
  const t0 = 100000;

  const lease = manager.acquireLease({
    workerId: 'worker-01',
    taskId: 'task-job-9999',
    durationMs: 10000,
    now: t0,
  });

  // First heartbeat with sequence 1 -> transitions to ACTIVE
  const hb1 = manager.heartbeat({
    taskId: 'task-job-9999',
    workerId: 'worker-01',
    token: lease.token,
    sequence: 1,
    now: t0 + 2000,
  });
  assert.equal(hb1.state, LEASE_STATES.ACTIVE);
  assert.equal(hb1.heartbeatSequence, 1);

  // Non-monotonic heartbeat (sequence 1 again) -> throws
  assert.throws(
    () =>
      manager.heartbeat({
        taskId: 'task-job-9999',
        workerId: 'worker-01',
        token: lease.token,
        sequence: 1,
        now: t0 + 3000,
      }),
    (err) => err instanceof WorkerLeaseContractError && err.code === 'ERR_NON_MONOTONIC_SEQUENCE'
  );

  // Heartbeat with extension
  const hb2 = manager.heartbeat({
    taskId: 'task-job-9999',
    workerId: 'worker-01',
    token: lease.token,
    sequence: 2,
    extendMs: 15000,
    now: t0 + 4000,
  });
  assert.equal(hb2.expiresAt, t0 + 4000 + 15000);
  assert.equal(hb2.renewalCount, 1);
});

test('WorkerLeaseContract: rejects forged tokens and expired leases', () => {
  const manager = new WorkerLeaseContract({ heartbeatGracePeriodMs: 1000 });
  const t0 = 100000;

  const lease = manager.acquireLease({
    workerId: 'worker-01',
    taskId: 'task-job-forge',
    durationMs: 5000,
    now: t0,
  });

  // Forged token
  assert.throws(
    () =>
      manager.heartbeat({
        taskId: 'task-job-forge',
        workerId: 'worker-01',
        token: 'forged-token-abc',
        sequence: 1,
        now: t0 + 1000,
      }),
    (err) => err instanceof WorkerLeaseContractError && err.code === 'ERR_INVALID_TOKEN'
  );

  // Heartbeat after expiration + grace period (5000 + 1000 = 6000ms)
  assert.throws(
    () =>
      manager.heartbeat({
        taskId: 'task-job-forge',
        workerId: 'worker-01',
        token: lease.token,
        sequence: 1,
        now: t0 + 7000,
      }),
    (err) => err instanceof WorkerLeaseContractError && err.code === 'ERR_LEASE_EXPIRED'
  );
});

test('WorkerLeaseContract: release and zombie lease reclamation', () => {
  const manager = new WorkerLeaseContract({ heartbeatGracePeriodMs: 1000 });
  const t0 = 100000;

  const lease1 = manager.acquireLease({
    workerId: 'worker-01',
    taskId: 'task-release-test',
    durationMs: 10000,
    now: t0,
  });

  // Clean release
  const rel = manager.releaseLease({
    taskId: 'task-release-test',
    workerId: 'worker-01',
    token: lease1.token,
  });
  assert.equal(rel.state, LEASE_STATES.RELEASED);

  // Expired lease reclamation
  manager.acquireLease({
    workerId: 'worker-02',
    taskId: 'task-zombie-test',
    durationMs: 5000,
    now: t0,
  });

  const reclaimed = manager.reclaimExpiredLeases(t0 + 7000);
  assert.deepEqual(reclaimed, ['task-zombie-test']);
  assert.equal(manager.getLease('task-zombie-test').state, LEASE_STATES.EXPIRED);
});
