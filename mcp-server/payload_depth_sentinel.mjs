// payload_depth_sentinel.mjs – detects deeply nested MCP payloads
export function checkPayloadDepth(depth, maxDepth = 8) {
  return depth <= maxDepth;
}
