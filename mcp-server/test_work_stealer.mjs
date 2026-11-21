import assert from 'node:assert/strict';
import { WorkStealingPool, TaskPriority } from './work_stealer.mjs';

console.log('running work_stealer unit tests...');

// 1. Balanced submission
{
  const pool = new WorkStealingPool({ workerCount: 3, maxConcurrency: 2 });
  pool.submitTask('task-1', TaskPriority.MEDIUM);
  pool.submitTask('task-2', TaskPriority.MEDIUM);
  pool.submitTask('task-3', TaskPriority.MEDIUM);

  const snap = pool.getSnapshot();
  assert.equal(snap.totalSubmitted, 3);
  // Each worker gets exactly 1 task
  assert.equal(snap.workers[0].queueLength, 1);
  assert.equal(snap.workers[1].queueLength, 1);
  assert.equal(snap.workers[2].queueLength, 1);
  console.log('ok   Balanced task submission across multiple worker queues');
}

// 2. Priority execution
{
  const pool = new WorkStealingPool({ workerCount: 1, maxConcurrency: 10 });
  pool.submitTask('low-1', TaskPriority.LOW);
  pool.submitTask('critical-1', TaskPriority.CRITICAL);
  pool.submitTask('medium-1', TaskPriority.MEDIUM);

  // Worker should receive critical-1 first, then medium-1, then low-1
  const t1 = pool.nextTask(0);
  assert.equal(t1.id, 'critical-1');

  const t2 = pool.nextTask(0);
  assert.equal(t2.id, 'medium-1');

  const t3 = pool.nextTask(0);
  assert.equal(t3.id, 'low-1');
  console.log('ok   Local queue prioritizes CRITICAL tasks over MEDIUM/LOW');
}

// 3. Concurrency Semaphore
{
  const pool = new WorkStealingPool({ workerCount: 1, maxConcurrency: 2 });
  pool.submitTask('t1');
  pool.submitTask('t2');
  pool.submitTask('t3');

  const a1 = pool.nextTask(0);
  const a2 = pool.nextTask(0);
  const a3 = pool.nextTask(0); // Should be null because maxConcurrency is 2

  assert.ok(a1);
  assert.ok(a2);
  assert.equal(a3, null);

  pool.completeTask(0, a1.id);
  const a4 = pool.nextTask(0); // Now available after completing 1
  assert.ok(a4);
  assert.equal(a4.id, 't3');
  console.log('ok   Worker concurrency semaphore caps active execution');
}

// 4. Work Stealing Mechanism
{
  const pool = new WorkStealingPool({ workerCount: 2, maxConcurrency: 5 });
  // Manually force all tasks onto Worker 0
  pool.workers[0].queue.push({
    id: 'heavy-1',
    basePriority: TaskPriority.MEDIUM,
    effectivePriority: TaskPriority.MEDIUM,
    submittedAtMs: 1000,
    assignedWorkerId: 0,
  });
  pool.workers[0].queue.push({
    id: 'heavy-2',
    basePriority: TaskPriority.MEDIUM,
    effectivePriority: TaskPriority.MEDIUM,
    submittedAtMs: 1000,
    assignedWorkerId: 0,
  });

  // Worker 1 is empty, requests nextTask -> steals heavy-2 from Worker 0
  const stolen = pool.nextTask(1, 1000);
  assert.ok(stolen);
  assert.equal(stolen.id, 'heavy-2');
  assert.equal(stolen.assignedWorkerId, 1);

  const snap = pool.getSnapshot();
  assert.equal(snap.totalStolen, 1);
  assert.equal(snap.workers[1].stolenCount, 1);
  assert.equal(snap.workers[0].queueLength, 1);
  console.log('ok   Idle worker steals task from overloaded sibling');
}

// 5. Priority Aging & Starvation Mitigation
{
  const pool = new WorkStealingPool({ workerCount: 1, maxConcurrency: 10, agingThresholdMs: 3000 });
  const t0 = 1000;
  pool.submitTask('old-low', TaskPriority.LOW, {}, t0);

  // Time advances past agingThresholdMs (t0 + 4000)
  const task = pool.nextTask(0, t0 + 4000);
  assert.equal(task.id, 'old-low');
  // Boosted from LOW (1) to MEDIUM (2)
  assert.equal(task.effectivePriority, TaskPriority.MEDIUM);
  console.log('ok   Priority aging prevents starvation of aged tasks');
}

// 6. Queue Saturation Guard
{
  const pool = new WorkStealingPool({ workerCount: 1, maxQueueDepth: 10 });
  for (let i = 0; i < 10; i++) {
    pool.submitTask(`t-${i}`);
  }

  assert.throws(() => pool.submitTask('overflow-task'), /queue depth limit/);
  console.log('ok   Queue depth limit rejects overflow tasks when saturated');
}

console.log('all work_stealer unit tests passed successfully!');
