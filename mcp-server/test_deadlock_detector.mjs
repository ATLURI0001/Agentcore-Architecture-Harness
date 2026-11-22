import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentDeadlockDetector, ResolutionStrategy } from './deadlock_detector.mjs';

test('AgentDeadlockDetector: adds and removes dependency edges cleanly', () => {
  const detector = new AgentDeadlockDetector();
  detector.addWaitDependency('agent-1', 'agent-2', { resource: 'tool-lock' });

  assert.equal(detector.waitGraph.size, 1);
  assert.equal(detector.getTelemetry().activeEdges, 1);

  const removed = detector.removeWaitDependency('agent-1');
  assert.equal(removed, true);
  assert.equal(detector.waitGraph.size, 0);
});

test('AgentDeadlockDetector: rejects self-dependency immediately', () => {
  const detector = new AgentDeadlockDetector();
  assert.throws(
    () => detector.addWaitDependency('agent-self', 'agent-self'),
    /Self-dependency deadlock/
  );
});

test('AgentDeadlockDetector: detects no cycles in acyclic dependency chains', () => {
  const detector = new AgentDeadlockDetector();
  detector.addWaitDependency('agent-A', 'agent-B');
  detector.addWaitDependency('agent-B', 'agent-C');

  const cycles = detector.detectCycles();
  assert.equal(cycles.length, 0);
  assert.equal(detector.getTelemetry().deadlocksDetected, 0);
});

test('AgentDeadlockDetector: detects 2-agent circular wait (A -> B -> A)', () => {
  const detector = new AgentDeadlockDetector();
  detector.addWaitDependency('agent-A', 'agent-B');
  detector.addWaitDependency('agent-B', 'agent-A');

  const cycles = detector.detectCycles();
  assert.equal(cycles.length, 1);
  assert.deepEqual(cycles[0], ['agent-A', 'agent-B', 'agent-A']);
  assert.equal(detector.getTelemetry().deadlocksDetected, 1);
});

test('AgentDeadlockDetector: detects 3-agent circular wait (A -> B -> C -> A)', () => {
  const detector = new AgentDeadlockDetector();
  detector.addWaitDependency('agent-A', 'agent-B');
  detector.addWaitDependency('agent-B', 'agent-C');
  detector.addWaitDependency('agent-C', 'agent-A');

  const cycles = detector.detectCycles();
  assert.equal(cycles.length, 1);
  assert.deepEqual(cycles[0], ['agent-A', 'agent-B', 'agent-C', 'agent-A']);
});

test('AgentDeadlockDetector: detects expired wait timeouts accurately', () => {
  const detector = new AgentDeadlockDetector({ defaultTimeoutMs: 5000 });
  const baseTime = 100000;

  detector.addWaitDependency('agent-stalled', 'agent-holder', {
    startTime: baseTime,
    timeoutMs: 2000,
  });

  // Check before timeout
  const none = detector.detectTimeouts(baseTime + 1000);
  assert.equal(none.length, 0);

  // Check after timeout
  const tripped = detector.detectTimeouts(baseTime + 3000);
  assert.equal(tripped.length, 1);
  assert.equal(tripped[0].waiterId, 'agent-stalled');
  assert.equal(tripped[0].elapsedMs, 3000);
  assert.equal(detector.getTelemetry().timeoutsTripped, 1);
});

test('AgentDeadlockDetector: resolves deadlocks by preempting newest edge', () => {
  const detector = new AgentDeadlockDetector({
    strategy: ResolutionStrategy.PREEMPT_NEWEST,
  });

  detector.addWaitDependency('agent-old', 'agent-mid', { startTime: 1000 });
  detector.addWaitDependency('agent-mid', 'agent-new', { startTime: 2000 });
  detector.addWaitDependency('agent-new', 'agent-old', { startTime: 3000 }); // newest edge causes cycle

  const resolutions = detector.resolveDeadlocks();
  assert.equal(resolutions.length, 1);
  assert.equal(resolutions[0].victimId, 'agent-new');

  // Verify graph is now acyclic
  const remainingCycles = detector.detectCycles();
  assert.equal(remainingCycles.length, 0);
  assert.equal(detector.getTelemetry().deadlocksResolved, 1);
});

test('AgentDeadlockDetector: resets telemetry and graph state cleanly', () => {
  const detector = new AgentDeadlockDetector();
  detector.addWaitDependency('A', 'B');
  detector.reset();

  assert.equal(detector.waitGraph.size, 0);
  assert.equal(detector.getTelemetry().totalWaitsRecorded, 0);
});
