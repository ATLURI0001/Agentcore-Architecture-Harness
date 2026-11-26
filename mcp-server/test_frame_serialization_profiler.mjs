import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameSerializationProfiler } from './frame_serialization_profiler.mjs';

test('FrameSerializationProfiler: frame and unframe round-trip', () => {
  const profiler = new FrameSerializationProfiler();
  const payload = {
    jsonrpc: '2.0',
    id: 'req_1234',
    method: 'tools/call',
    params: { name: 'calculator', arguments: { a: 10, b: 20 } },
  };

  const framed = profiler.frameMessage(payload);
  assert.ok(Buffer.isBuffer(framed));
  assert.ok(framed.toString('utf-8').startsWith('Content-Length:'));

  const unframed = profiler.unframeMessage(framed);
  assert.deepEqual(unframed, payload);
});

test('FrameSerializationProfiler: input validation guards', () => {
  const profiler = new FrameSerializationProfiler({ maxPayloadSizeBytes: 50 });

  assert.throws(
    () => profiler.frameMessage(null),
    { name: 'TypeError', message: /Payload cannot be null/ }
  );

  assert.throws(
    () => profiler.frameMessage({ text: 'this payload is longer than 50 bytes by far' }),
    { name: 'RangeError', message: /Frame exceeds maximum payload size/ }
  );

  assert.throws(
    () => profiler.unframeMessage('not-a-buffer'),
    { name: 'TypeError', message: /Input must be a Node.js Buffer/ }
  );

  assert.throws(
    () => profiler.unframeMessage(Buffer.from('no header here')),
    { name: 'Error', message: /missing or invalid Content-Length/ }
  );
});

test('FrameSerializationProfiler: profileFraming metrics computation', () => {
  const profiler = new FrameSerializationProfiler();
  const metrics = profiler.profileFraming(150, 'standard');

  assert.equal(metrics.iterations, 150);
  assert.equal(metrics.payloadType, 'standard');
  assert.ok(metrics.throughputFramesPerSec > 0);
  assert.ok(metrics.megabytesPerSec >= 0);
  assert.ok(metrics.meanLatencyUs >= 0);
  assert.ok(metrics.p50LatencyUs >= 0);
  assert.ok(metrics.p90LatencyUs >= metrics.p50LatencyUs);
  assert.ok(metrics.p99LatencyUs >= metrics.p90LatencyUs);
});
