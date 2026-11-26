export function assertLoopDepthWithinLimit(depth, maxDepth = 16) {
  if (depth < 0 || depth > maxDepth) {
    throw new Error(`Sentinel violation: agent loop depth ${depth} exceeds max ${maxDepth}`);
  }
}
