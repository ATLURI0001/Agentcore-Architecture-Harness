// mcp_transport_circuit_breaker.mjs – circuit breaker for MCP transport errors
let failures = 0;
let open = false;

export function recordTransportFailure(threshold = 3) {
  failures++;
  if (failures >= threshold) open = true;
}

export function isTransportOpen() { return open; }
export function resetTransport() { failures = 0; open = false; }
