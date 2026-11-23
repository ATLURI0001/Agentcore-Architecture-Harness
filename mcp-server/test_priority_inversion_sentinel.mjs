import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PriorityInversionSentinel,
  PriorityLevel,
} from './priority_inversion_sentinel.mjs';

test('PriorityInversionSentinel: dequeues strictly by effective priority and FIFO', () => {
  const sentinel = new PriorityInversionSentinel();

  sentinel.enqueueTask('task-bg', PriorityLevel.BACKGROUND);
  sentinel.enqueueTask('task-crit', PriorityLevel.CRITICAL);
  sentinel.enqueueTask('task-high', PriorityLevel.HIGH);
  sentinel.enqueueTask('task-norm', PriorityLevel.NORMAL);

  assert.equal(sentinel.dequeueNextTask().id, 'task-crit');
  assert.equal(sentinel.dequeueNextTask().id, 'task-high');
  assert.equal(sentinel.dequeueNextTask().id, 'task-norm');
  assert.equal(sentinel.dequeueNextTask().id, 'task-bg');
});

test('PriorityInversionSentinel: implements priority inheritance to resolve blockages', () => {
  const sentinel = new PriorityInversionSentinel();

  // Low-priority task holds resource 'db-tx'
  sentinel.enqueueTask('worker-low', PriorityLevel.BACKGROUND);
  const acquired = sentinel.acquireResource('db-tx', 'worker-low');
  assert.equal(acquired, true);

  // High-priority task blocks on 'db-tx'
  sentinel.enqueueTask('worker-high', PriorityLevel.CRITICAL);
  const blocked = sentinel.acquireResource('db-tx', 'worker-high');
  assert.equal(blocked, false);

  // worker-low should inherit CRITICAL priority from worker-high
  const lowTask = sentinel.tasks.get('worker-low');
  assert.equal(lowTask.effectivePriority, PriorityLevel.CRITICAL);
  assert.equal(lowTask.inheritedFrom, 'worker-high');

  // worker-low is now dequeued first to unblock the critical resource!
  const nextTask = sentinel.dequeueNextTask();
  assert.equal(nextTask.id, 'worker-low');

  // When worker-low releases the lock, worker-high receives it
  sentinel.releaseResource('db-tx', 'worker-low');
  assert.equal(sentinel.resourceLocks.get('db-tx'), 'worker-high');
});

test('PriorityInversionSentinel: applies time-based priority aging to prevent starvation', () => {
  const sentinel = new PriorityInversionSentinel({ agingIntervalMs: 100 });
  const t0 = 100000;

  const bgTask = sentinel.enqueueTask('stale-bg', PriorityLevel.BACKGROUND);
  bgTask.enqueuedAt = t0;

  // 150ms later -> 1 boost tier (BACKGROUND -> NORMAL)
  const boosts1 = sentinel.applyTaskAging(t0 + 150);
  assert.equal(boosts1, 1);
  assert.equal(bgTask.effectivePriority, PriorityLevel.NORMAL);

  // 350ms later -> promoted all the way to CRITICAL
  sentinel.applyTaskAging(t0 + 350);
  assert.equal(bgTask.effectivePriority, PriorityLevel.CRITICAL);
});

test('PriorityInversionSentinel: detects starved tasks beyond threshold', () => {
  const sentinel = new PriorityInversionSentinel({ starvationThresholdMs: 500 });
  const t0 = 50000;

  const task = sentinel.enqueueTask('starved-task', PriorityLevel.BACKGROUND);
  task.enqueuedAt = t0;

  // 200ms -> not starved yet
  const none = sentinel.detectStarvation(t0 + 200);
  assert.equal(none.length, 0);

  // 600ms -> starved
  const starved = sentinel.detectStarvation(t0 + 600);
  assert.equal(starved.length, 1);
  assert.equal(starved[0].taskId, 'starved-task');
  assert.equal(starved[0].ageMs, 600);
});

test('PriorityInversionSentinel: enforces input validation and capacity limit', () => {
  const sentinel = new PriorityInversionSentinel({ maxQueueCapacity: 2 });
  sentinel.enqueueTask('t1');
  sentinel.enqueueTask('t2');

  assert.throws(() => sentinel.enqueueTask('t3'), /Queue capacity limit reached/);
  assert.throws(() => sentinel.enqueueTask(null), TypeError);
  assert.throws(() => sentinel.acquireResource('res', 'unknown-task'), /Unknown task/);
});
