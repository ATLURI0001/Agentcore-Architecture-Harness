/**
 * @file priority_inversion_sentinel.mjs
 * Multi-Agent Priority Inversion Sentinel & Task Starvation Rotary.
 * Enforces dynamic priority inheritance and time-based task aging to prevent deadlocks.
 */

export const PriorityLevel = {
  CRITICAL: 0,
  HIGH: 1,
  NORMAL: 2,
  BACKGROUND: 3,
};

export class PriorityInversionSentinel {
  /**
   * @param {object} [options={}]
   * @param {number} [options.agingIntervalMs=500] - Interval after which waiting tasks promote up a tier
   * @param {number} [options.maxQueueCapacity=1000]
   * @param {number} [options.starvationThresholdMs=2000] - Threshold to flag starvation warning
   */
  constructor(options = {}) {
    this.agingIntervalMs = Math.max(50, options.agingIntervalMs || 500);
    this.maxQueueCapacity = Math.max(1, options.maxQueueCapacity || 1000);
    this.starvationThresholdMs = Math.max(100, options.starvationThresholdMs || 2000);

    // Map of taskId -> task descriptor
    this.tasks = new Map();
    // Resource lock map: resourceId -> holderTaskId
    this.resourceLocks = new Map();
    // Dependency map: waiterTaskId -> resourceId
    this.resourceWaiters = new Map();
  }

  /**
   * Enqueues a new agent task with initial assigned priority.
   */
  enqueueTask(taskId, priority = PriorityLevel.NORMAL, metadata = {}) {
    if (!taskId || typeof taskId !== 'string') {
      throw new TypeError('taskId must be a non-empty string');
    }
    if (this.tasks.size >= this.maxQueueCapacity) {
      throw new Error(`Queue capacity limit reached (${this.maxQueueCapacity})`);
    }

    const assigned = Number.isInteger(priority) && priority >= 0 && priority <= 3
      ? priority
      : PriorityLevel.NORMAL;

    const task = {
      id: taskId,
      basePriority: assigned,
      effectivePriority: assigned,
      enqueuedAt: Date.now(),
      boostedByAging: 0,
      inheritedFrom: null,
      metadata,
    };

    this.tasks.set(taskId, task);
    return task;
  }

  /**
   * Acquires a shared resource lock on behalf of a task.
   */
  acquireResource(resourceId, taskId) {
    if (!this.tasks.has(taskId)) {
      throw new Error(`Unknown task ${taskId}`);
    }

    const currentHolder = this.resourceLocks.get(resourceId);
    if (!currentHolder) {
      this.resourceLocks.set(resourceId, taskId);
      this.resourceWaiters.delete(taskId);
      return true;
    }

    if (currentHolder === taskId) {
      return true; // Reentrant
    }

    // Task is blocked waiting for resourceId held by currentHolder
    this.resourceWaiters.set(taskId, resourceId);

    // Check Priority Inversion:
    // If waiting task has higher priority (lower numeric value) than current holder,
    // holder inherits the higher priority!
    const waiter = this.tasks.get(taskId);
    const holder = this.tasks.get(currentHolder);

    if (waiter && holder && waiter.effectivePriority < holder.effectivePriority) {
      holder.effectivePriority = waiter.effectivePriority;
      holder.inheritedFrom = taskId;
    }

    return false;
  }

  /**
   * Releases a resource lock and resets inherited priority if no longer needed.
   */
  releaseResource(resourceId, taskId) {
    const currentHolder = this.resourceLocks.get(resourceId);
    if (currentHolder !== taskId) {
      return false;
    }

    this.resourceLocks.delete(resourceId);

    // Reset effective priority to base or age-boosted level
    const holder = this.tasks.get(taskId);
    if (holder) {
      holder.effectivePriority = Math.max(0, holder.basePriority - holder.boostedByAging);
      holder.inheritedFrom = null;
    }

    // Hand off to highest priority waiter
    let nextWaiterId = null;
    let highestPri = 999;

    for (const [wId, rId] of this.resourceWaiters.entries()) {
      if (rId === resourceId) {
        const wTask = this.tasks.get(wId);
        if (wTask && wTask.effectivePriority < highestPri) {
          highestPri = wTask.effectivePriority;
          nextWaiterId = wId;
        }
      }
    }

    if (nextWaiterId) {
      this.resourceLocks.set(resourceId, nextWaiterId);
      this.resourceWaiters.delete(nextWaiterId);
    }

    return true;
  }

  /**
   * Applies time-based priority aging to prevent starvation of low-priority tasks.
   */
  applyTaskAging(currentTime = Date.now()) {
    let boostedCount = 0;

    for (const task of this.tasks.values()) {
      const waitingDuration = currentTime - task.enqueuedAt;
      const eligibleBoosts = Math.floor(waitingDuration / this.agingIntervalMs);

      if (eligibleBoosts > task.boostedByAging && task.effectivePriority > PriorityLevel.CRITICAL) {
        const newBoost = Math.min(task.basePriority, eligibleBoosts);
        task.boostedByAging = newBoost;
        // Priority promotion (numerically lower)
        task.effectivePriority = Math.max(PriorityLevel.CRITICAL, task.basePriority - newBoost);
        boostedCount++;
      }
    }

    return boostedCount;
  }

  /**
   * Dequeues the next highest-priority task (lowest effectivePriority, then FIFO).
   */
  dequeueNextTask() {
    if (this.tasks.size === 0) {
      return null;
    }

    let bestTask = null;

    for (const task of this.tasks.values()) {
      if (!bestTask) {
        bestTask = task;
        continue;
      }

      if (task.effectivePriority < bestTask.effectivePriority) {
        bestTask = task;
      } else if (task.effectivePriority === bestTask.effectivePriority) {
        // FIFO order
        if (task.enqueuedAt < bestTask.enqueuedAt) {
          bestTask = task;
        }
      }
    }

    if (bestTask) {
      this.tasks.delete(bestTask.id);
      this.resourceWaiters.delete(bestTask.id);
    }

    return bestTask;
  }

  /**
   * Scans for tasks waiting longer than starvationThresholdMs.
   */
  detectStarvation(currentTime = Date.now()) {
    const starvedTasks = [];

    for (const task of this.tasks.values()) {
      const age = currentTime - task.enqueuedAt;
      if (age >= this.starvationThresholdMs) {
        starvedTasks.push({
          taskId: task.id,
          ageMs: age,
          basePriority: task.basePriority,
          effectivePriority: task.effectivePriority,
          inheritedFrom: task.inheritedFrom,
        });
      }
    }

    return starvedTasks;
  }

  getQueueSize() {
    return this.tasks.size;
  }

  reset() {
    this.tasks.clear();
    this.resourceLocks.clear();
    this.resourceWaiters.clear();
  }
}
