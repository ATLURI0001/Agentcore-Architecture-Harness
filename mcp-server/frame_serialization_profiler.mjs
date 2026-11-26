/**
 * AgentCore MCP Server: JSON-RPC Frame Serialization & Ingress Profiler.
 * 
 * Measures throughput (frames/sec, MB/s) and latency distributions (p50/p90/p99)
 * for JSON-RPC 2.0 message framing, payload serialization, and deserialization
 * across MCP client-server communication channels.
 */

export class FrameSerializationProfiler {
  constructor(options = {}) {
    this.maxBatchSize = options.maxBatchSize ?? 1000;
    this.maxPayloadSizeBytes = options.maxPayloadSizeBytes ?? 16 * 1024 * 1024;
  }

  /**
   * Frames a JSON-RPC payload with Content-Length header framing according to LSP/MCP stdio transport.
   * Format: `Content-Length: <size>\r\n\r\n<json>`
   */
  frameMessage(payload) {
    if (payload === undefined || payload === null) {
      throw new TypeError('Payload cannot be null or undefined');
    }
    const jsonStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const bodyBuf = Buffer.from(jsonStr, 'utf-8');
    if (bodyBuf.length > this.maxPayloadSizeBytes) {
      throw new RangeError(`Frame exceeds maximum payload size of ${this.maxPayloadSizeBytes} bytes`);
    }
    const headerStr = `Content-Length: ${bodyBuf.length}\r\n\r\n`;
    const headerBuf = Buffer.from(headerStr, 'ascii');
    return Buffer.concat([headerBuf, bodyBuf]);
  }

  /**
   * Unframes a raw buffer and extracts the JSON-RPC payload object.
   */
  unframeMessage(buffer) {
    if (!Buffer.isBuffer(buffer)) {
      throw new TypeError('Input must be a Node.js Buffer');
    }
    const str = buffer.toString('utf-8');
    const headerMatch = str.match(/^Content-Length:\s*(\d+)\r\n\r\n/i);
    if (!headerMatch) {
      throw new Error('Malformed frame: missing or invalid Content-Length header');
    }

    const headerLen = headerMatch[0].length;
    const expectedBodyLen = parseInt(headerMatch[1], 10);
    const bodyBuf = buffer.subarray(headerLen);

    if (bodyBuf.length < expectedBodyLen) {
      throw new Error(`Incomplete frame: expected ${expectedBodyLen} bytes, got ${bodyBuf.length}`);
    }

    const rawJson = bodyBuf.subarray(0, expectedBodyLen).toString('utf-8');
    return JSON.parse(rawJson);
  }

  /**
   * Generates a synthetic JSON-RPC 2.0 message for benchmarking.
   */
  createSyntheticFrame(type = 'tool_call', payloadSize = 1024) {
    const id = 'req_' + Math.floor(Math.random() * 1000000);
    if (type === 'ping') {
      return { jsonrpc: '2.0', id, method: 'ping', params: {} };
    }
    if (type === 'tool_result') {
      const padding = 'x'.repeat(Math.max(0, payloadSize - 128));
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: padding }],
          isError: false,
        },
      };
    }
    // tool_call
    const padding = 'a'.repeat(Math.max(0, payloadSize - 128));
    return {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: {
        name: 'sample_tool',
        arguments: { data: padding },
      },
    };
  }

  /**
   * Runs a benchmark profiling loop measuring framing and parsing performance.
   */
  profileFraming(iterations = 2000, payloadType = 'standard') {
    if (typeof iterations !== 'number' || iterations <= 0) {
      throw new TypeError('Iterations must be a positive integer');
    }

    const size = payloadType === 'compact' ? 64 : payloadType === 'jumbo' ? 32768 : 1024;
    const latenciesUs = new Array(iterations);
    let totalBytes = 0;

    const startTotal = process.hrtime.bigint();

    for (let i = 0; i < iterations; i++) {
      const msg = this.createSyntheticFrame(
        payloadType === 'compact' ? 'ping' : 'tool_call',
        size
      );

      const iterStart = process.hrtime.bigint();
      const framed = this.frameMessage(msg);
      const unframed = this.unframeMessage(framed);
      const iterEnd = process.hrtime.bigint();

      totalBytes += framed.length;
      let durUs = Number(iterEnd - iterStart) / 1000;
      if (durUs <= 0) durUs = 0.1;
      latenciesUs[i] = durUs;
    }

    const endTotal = process.hrtime.bigint();
    const totalNs = Number(endTotal - startTotal);
    const totalDurationMs = Math.max(1, totalNs / 1_000_000);

    latenciesUs.sort((a, b) => a - b);
    const meanLatencyUs = latenciesUs.reduce((sum, v) => sum + v, 0) / iterations;
    const p50LatencyUs = latenciesUs[Math.floor(iterations * 0.50)];
    const p90LatencyUs = latenciesUs[Math.floor(iterations * 0.90)];
    const p99LatencyUs = latenciesUs[Math.floor(iterations * 0.99)];

    const throughputFramesPerSec = Math.round((iterations / totalDurationMs) * 1000);
    const megabytesPerSec = Number(
      ((totalBytes / (1024 * 1024)) / (totalDurationMs / 1000)).toFixed(2)
    );

    return {
      payloadType,
      iterations,
      totalDurationMs: Number(totalDurationMs.toFixed(2)),
      throughputFramesPerSec,
      megabytesPerSec,
      totalBytesProcessed: totalBytes,
      meanLatencyUs: Number(meanLatencyUs.toFixed(2)),
      p50LatencyUs: Number(p50LatencyUs.toFixed(2)),
      p90LatencyUs: Number(p90LatencyUs.toFixed(2)),
      p99LatencyUs: Number(p99LatencyUs.toFixed(2)),
    };
  }
}
