/**
 * @file message_dispatcher_profiler.mjs
 * High-performance circular ring-buffer agent message dispatcher and benchmark profiler.
 */

export class AgentMessageDispatcher {
  constructor(options = {}) {
    this.capacity = Math.max(1, Number(options.capacity) || 10000);
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.totalPublished = 0;

    // Subscribers mapped by agentId -> { topicPattern, handler }
    this.subscribers = new Map();
  }

  /**
   * Registers a subscriber callback for a specific topic pattern (or '*' for all).
   */
  subscribe(agentId, topicPattern, handler) {
    if (!agentId || typeof agentId !== 'string') {
      throw new TypeError('agentId must be a non-empty string');
    }
    if (typeof handler !== 'function') {
      throw new TypeError('handler must be a callable function');
    }

    const pattern = topicPattern ? String(topicPattern).trim() : '*';
    const sub = {
      agentId: agentId.trim(),
      topicPattern: pattern,
      handler,
    };

    this.subscribers.set(sub.agentId, sub);

    return () => {
      this.subscribers.delete(sub.agentId);
    };
  }

  /**
   * Removes a registered subscriber by agentId.
   */
  unsubscribe(agentId) {
    return this.subscribers.delete(String(agentId).trim());
  }

  /**
   * Publishes an event to the circular ring buffer and delivers to matching subscribers.
   */
  publish(topic, payload) {
    if (!topic || typeof topic !== 'string') {
      throw new TypeError('topic must be a non-empty string');
    }

    const event = {
      sequence: this.totalPublished++,
      topic: topic.trim(),
      payload,
      timestamp: Date.now(),
    };

    // Store in circular ring buffer
    const slot = this.head % this.capacity;
    this.buffer[slot] = event;
    this.head++;

    // Fan-out delivery
    let deliveredCount = 0;
    for (const sub of this.subscribers.values()) {
      if (sub.topicPattern === '*' || sub.topicPattern === event.topic) {
        sub.handler(event);
        deliveredCount++;
      }
    }

    return deliveredCount;
  }

  /**
   * Retrieves the current number of subscribers.
   */
  get subscriberCount() {
    return this.subscribers.size;
  }

  /**
   * Resets the buffer and subscriber list.
   */
  clear() {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.totalPublished = 0;
    this.subscribers.clear();
  }
}

/**
 * Executes a deterministic micro-benchmark profiling dispatcher throughput and latency.
 */
export function runDispatcherBenchmark(subscriberCount = 10, messageCount = 20000) {
  const dispatcher = new AgentMessageDispatcher({ capacity: messageCount });
  let deliveredTotal = 0;

  // Register subscribers across 3 topics
  const topics = ['agent.task.assign', 'agent.state.sync', 'agent.broadcast'];
  for (let i = 0; i < subscriberCount; i++) {
    const topic = i % 3 === 0 ? '*' : topics[i % topics.length];
    dispatcher.subscribe(`sub-agent-${i}`, topic, () => {
      deliveredTotal++;
    });
  }

  const latenciesUs = new Array(messageCount);
  const memBefore = process.memoryUsage().heapUsed;
  const tStart = performance.now();

  for (let m = 0; m < messageCount; m++) {
    const topic = topics[m % topics.length];
    const t0 = performance.now();
    dispatcher.publish(topic, { msgId: m, load: 'task-data' });
    const t1 = performance.now();
    latenciesUs[m] = (t1 - t0) * 1000; // in microseconds
  }

  const tEnd = performance.now();
  const memAfter = process.memoryUsage().heapUsed;
  const totalDurationMs = tEnd - tStart;

  latenciesUs.sort((a, b) => a - b);
  const sumUs = latenciesUs.reduce((acc, v) => acc + v, 0);
  const meanLatencyUs = Number((sumUs / messageCount).toFixed(2));
  const p50LatencyUs = Number(latenciesUs[Math.floor(messageCount * 0.50)].toFixed(2));
  const p90LatencyUs = Number(latenciesUs[Math.floor(messageCount * 0.90)].toFixed(2));
  const p99LatencyUs = Number(latenciesUs[Math.floor(messageCount * 0.99)].toFixed(2));

  const throughputOpsSec = totalDurationMs > 0
    ? Math.round((messageCount * 1000) / totalDurationMs)
    : 0;

  return {
    subscribers: subscriberCount,
    messageCount,
    deliveredTotal,
    totalDurationMs: Number(totalDurationMs.toFixed(2)),
    meanLatencyUs,
    p50LatencyUs,
    p90LatencyUs,
    p99LatencyUs,
    throughputOpsSec,
    heapDeltaBytes: Math.max(0, memAfter - memBefore),
  };
}
