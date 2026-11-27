// agentcore-architecture-harness: memory footprint profiler
export function profileMemory(label, fn) {
  const before = process.memoryUsage().heapUsed;
  fn();
  const after = process.memoryUsage().heapUsed;
  return { label, deltaBytes: after - before };
}
