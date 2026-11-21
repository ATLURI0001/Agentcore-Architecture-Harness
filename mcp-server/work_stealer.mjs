/**
 * Distributed Task Execution Semaphore & Work-Stealing Pool Rotary
 *
 * Implements a multi-worker work-stealing scheduler with double-ended deques,
 * priority aging, starvation mitigation, and concurrency semaphores.
 */

export const TaskPriority = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export class WorkStealingPool {
  /**
   * @param {object} options
   * @param {number} [options.workerCount=4] - Total worker threads/slots
   * @param {number} [options.maxConcurrency=2] - Maximum concurrent tasks per worker
   * @param {number} [options.maxQueueDepth=100] - Max backlog capacity per worker
   * @param {number} [options.agingThresholdMs=5000] - Age in ms before priority escalation
   */
  constructor(options = {}) {
    this.workerCount = Math.max(1, Number(options.workerCount) || 4);
    this.maxConcurrency = Math.max(1, Number(options.maxConcurrency) || 2);
    this.maxQueueDepth = Math.max(10, Number(options.maxQueueDepth) || 100);
    this.agingThresholdMs = Math.max(500, Number(options.agingThresholdMs) || 5000);

    /** @type {Array<{ id: number, activeCount: number, queue: Array<object>, completedCount: number, stolenCount: number }>} */
    this.workers = [];
    for (let i = 0; i < this.workerCount; i++) {
      this.workers.push({
        id: i,
        activeCount: 0,
        queue: [],
        completedCount: 0,
        stolenCount: 0,
      });
    }

    this.totalSubmitted = 0;
    this.totalStolen = 0;
    this.totalCompleted = 0;
  }

  /**
   * Submits a task to the pool, placing it in the worker with the lowest total load.
   *
   * @param {string} taskId
   * @param {number} [priority=TaskPriority.MEDIUM]
   * @param {object} [metadata={}]
   * @param {number} [timestampMs]
   * @returns {{ submitted: boolean, workerId: number, task: object }}
   */
  submitTask(taskId, priority = TaskPriority.MEDIUM, metadata = {}, timestampMs = Date.now()) {
    if (!taskId || typeof taskId !== 'string') {
      throw new Error('taskId must be a non-empty string');
    }

    // Find worker with lowest total load (active + queue)
    let bestWorker = this.workers[0];
    let minLoad = bestWorker.activeCount + bestWorker.queue.length;

    for (let i = 1; i < this.workers.length; i++) {
      const load = this.workers[i].activeCount + this.workers[i].queue.length;
      if (load < minLoad) {
        minLoad = load;
        bestWorker = this.workers[i];
      }
    }

    if (bestWorker.queue.length >= this.maxQueueDepth) {
      throw new Error(`Worker ${bestWorker.id} queue depth limit (${this.maxQueueDepth}) exceeded; pool saturated`);
    }

    const task = {
      id: taskId,
      basePriority: Number(priority) || TaskPriority.MEDIUM,
      effectivePriority: Number(priority) || TaskPriority.MEDIUM,
      metadata,
      submittedAtMs: timestampMs,
      assignedWorkerId: bestWorker.id,
    };

    bestWorker.queue.push(task);
    this.totalSubmitted++;

    return {
      submitted: true,
      workerId: bestWorker.id,
      task,
    };
  }

  /**
   * Worker requests next available task.
   * Pulls LIFO (head) from own queue, or steals FIFO (tail) from the most loaded sibling.
   *
   * @param {number} workerId
   * @param {number} [currentTimestampMs]
   * @returns {object|null}
   */
  nextTask(workerId, currentTimestampMs = Date.now()) {
    const worker = this.workers[workerId];
    if (!worker) {
      throw new Error(`Worker ${workerId} not found`);
    }

    if (worker.activeCount >= this.maxConcurrency) {
      return null; // Concurrency semaphore limit reached
    }

    // 1. Check local queue first (LIFO order for hot cache)
    if (worker.queue.length > 0) {
      this._applyPriorityAging(worker.queue, currentTimestampMs);
      // Sort so highest effective priority is at the head
      worker.queue.sort((a, b) => b.effectivePriority - a.effectivePriority);

      const task = worker.queue.shift();
      worker.activeCount++;
      return task;
    }

    // 2. Work Stealing: locate the sibling worker with the longest queue
    let targetWorker = null;
    let maxQueueLen = 0;

    for (const sibling of this.workers) {
      if (sibling.id !== workerId && sibling.queue.length > maxQueueLen) {
        maxQueueLen = sibling.queue.length;
        targetWorker = sibling;
      }
    }

    if (targetWorker && targetWorker.queue.length > 0) {
      this._applyPriorityAging(targetWorker.queue, currentTimestampMs);
      // Steal from tail (FIFO) to balance older tasks
      const stolenTask = targetWorker.queue.pop();
      stolenTask.assignedWorkerId = worker.id;
      worker.activeCount++;
      worker.stolenCount++;
      this.totalStolen++;
      return stolenTask;
    }

    return null;
  }

  /**
   * Completes a task, decrementing active worker count.
   *
   * @param {number} workerId
   * @param {string} taskId
   */
  completeTask(workerId, taskId) {
    const worker = this.workers[workerId];
    if (!worker) {
      throw new Error(`Worker ${workerId} not found`);
    }

    if (worker.activeCount > 0) {
      worker.activeCount--;
      worker.completedCount++;
      this.totalCompleted++;
    }
  }

  _applyPriorityAging(queue, currentTimestampMs) {
    for (const task of queue) {
      const ageMs = currentTimestampMs - task.submittedAtMs;
      if (ageMs >= this.agingThresholdMs && task.effectivePriority < TaskPriority.CRITICAL) {
        // Boost priority by 1 tier to prevent starvation
        task.effectivePriority = Math.min(TaskPriority.CRITICAL, task.basePriority + 1);
      }
    }
  }

  /**
   * Returns a diagnostic snapshot of the entire work-stealing pool.
   */
  getSnapshot() {
    return {
      workerCount: this.workerCount,
      totalSubmitted: this.totalSubmitted,
      totalCompleted: this.totalCompleted,
      totalStolen: this.totalStolen,
      workers: this.workers.map((w) => ({
        id: w.id,
        activeCount: w.activeCount,
        queueLength: w.queue.length,
        completedCount: w.completedCount,
        stolenCount: w.stolenCount,
      })),
    };
  }
}
