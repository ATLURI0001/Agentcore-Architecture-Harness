import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MessageTransitTelemetry } from './transit_telemetry.mjs';

describe('MessageTransitTelemetry Suite', () => {
  it('records message transit and validates inputs defensively', () => {
    const telemetry = new MessageTransitTelemetry();

    const record = telemetry.recordMessageTransit({
      msgId: 'msg-001',
      srcAgent: 'agent-planner',
      dstAgent: 'agent-coder',
      transitLatencyMs: 12.5,
      bufferOccupancy: 40,
      bufferCapacity: 100,
    });

    assert.equal(record.msgId, 'msg-001');
    assert.equal(record.srcAgent, 'agent-planner');
    assert.equal(record.dstAgent, 'agent-coder');
    assert.equal(record.transitLatencyMs, 12.5);
    assert.equal(record.saturation, 0.4);

    // Defensive input validation
    assert.throws(() => telemetry.recordMessageTransit(null), TypeError);
    assert.throws(
      () =>
        telemetry.recordMessageTransit({
          msgId: '',
          srcAgent: 'a',
          dstAgent: 'b',
          transitLatencyMs: 10,
        }),
      TypeError
    );
    assert.throws(
      () =>
        telemetry.recordMessageTransit({
          msgId: '1',
          srcAgent: 'a',
          dstAgent: 'b',
          transitLatencyMs: -5,
        }),
      RangeError
    );
  });

  it('computes transit latency percentiles accurately', () => {
    const telemetry = new MessageTransitTelemetry();

    for (let i = 1; i <= 100; i++) {
      telemetry.recordMessageTransit({
        msgId: `msg-${i}`,
        srcAgent: 'agent-a',
        dstAgent: 'agent-b',
        transitLatencyMs: i,
      });
    }

    const overall = telemetry.getTransitPercentiles();
    assert.equal(overall.count, 100);
    assert.equal(overall.meanMs, 50.5);
    assert.ok(overall.p50Ms >= 50 && overall.p50Ms <= 51);
    assert.ok(overall.p90Ms >= 90 && overall.p90Ms <= 91);
    assert.ok(overall.p99Ms >= 99 && overall.p99Ms <= 100);
    assert.equal(overall.maxMs, 100);

    const pair = telemetry.getTransitPercentiles('agent-a', 'agent-b');
    assert.equal(pair.count, 100);
  });

  it('evaluates buffer saturation and identifies warnings and critical pressure', () => {
    const telemetry = new MessageTransitTelemetry({
      saturationWarningThreshold: 0.8,
      saturationCriticalThreshold: 0.95,
    });

    telemetry.recordMessageTransit({
      msgId: 'msg-1',
      srcAgent: 'agent-a',
      dstAgent: 'agent-b',
      transitLatencyMs: 5,
      bufferId: 'queue-healthy',
      bufferOccupancy: 30,
      bufferCapacity: 100,
    });

    telemetry.recordMessageTransit({
      msgId: 'msg-2',
      srcAgent: 'agent-a',
      dstAgent: 'agent-b',
      transitLatencyMs: 5,
      bufferId: 'queue-warning',
      bufferOccupancy: 85,
      bufferCapacity: 100,
    });

    telemetry.recordMessageTransit({
      msgId: 'msg-3',
      srcAgent: 'agent-a',
      dstAgent: 'agent-b',
      transitLatencyMs: 5,
      bufferId: 'queue-critical',
      bufferOccupancy: 98,
      bufferCapacity: 100,
    });

    const report = telemetry.getBufferSaturationReport();
    assert.equal(report.length, 3);

    const healthy = report.find((r) => r.bufferId === 'queue-healthy');
    assert.equal(healthy.status, 'HEALTHY');

    const warning = report.find((r) => r.bufferId === 'queue-warning');
    assert.equal(warning.status, 'WARNING');

    const critical = report.find((r) => r.bufferId === 'queue-critical');
    assert.equal(critical.status, 'CRITICAL');
  });

  it('detects latency spikes and buffer saturation anomalies', () => {
    const telemetry = new MessageTransitTelemetry({
      latencyAnomalyThresholdMs: 40.0,
      saturationCriticalThreshold: 0.9,
    });

    // Record 10 transit records with high latency on agent-slow->agent-b
    for (let i = 1; i <= 10; i++) {
      telemetry.recordMessageTransit({
        msgId: `msg-slow-${i}`,
        srcAgent: 'agent-slow',
        dstAgent: 'agent-b',
        transitLatencyMs: 65.0,
        bufferId: 'saturated-ring',
        bufferOccupancy: 95,
        bufferCapacity: 100,
      });
    }

    const anomalies = telemetry.detectTransitAnomalies();
    assert.ok(anomalies.length >= 2);

    const latAnomaly = anomalies.find((a) => a.type === 'HIGH_TRANSIT_LATENCY');
    assert.ok(latAnomaly);
    assert.equal(latAnomaly.target, 'agent-slow->agent-b');

    const satAnomaly = anomalies.find((a) => a.type === 'CRITICAL_BUFFER_SATURATION');
    assert.ok(satAnomaly);
    assert.equal(satAnomaly.target, 'saturated-ring');
  });

  it('records dropped messages and formats Prometheus exposition', () => {
    const telemetry = new MessageTransitTelemetry();

    telemetry.recordMessageTransit({
      msgId: 'm-1',
      srcAgent: 'agent-1',
      dstAgent: 'agent-2',
      transitLatencyMs: 15.0,
      bufferId: 'ring-1',
      bufferOccupancy: 50,
      bufferCapacity: 100,
    });

    telemetry.recordDroppedMessage('ring-1', 'BUFFER_OVERFLOW');
    telemetry.recordDroppedMessage('ring-1', 'BUFFER_OVERFLOW');

    const prom = telemetry.exportPrometheusMetrics();
    assert.ok(prom.includes('agentcore_transit_latency_p90_ms{src="agent-1",dst="agent-2"}'));
    assert.ok(prom.includes('agentcore_buffer_saturation_ratio{buffer_id="ring-1"} 0.5000'));
    assert.ok(prom.includes('agentcore_dropped_messages_total{buffer_id="ring-1",reason="BUFFER_OVERFLOW"} 2'));

    telemetry.reset();
    assert.equal(telemetry.records.length, 0);
  });
});
