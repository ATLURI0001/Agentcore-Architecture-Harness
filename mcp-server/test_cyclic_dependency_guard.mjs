import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CyclicDependencyGuard,
  GuardAction,
} from './cyclic_dependency_guard.mjs';

describe('CyclicDependencyGuard Core Suite', () => {
  it('initializes with default options and clean graph', () => {
    const guard = new CyclicDependencyGuard();
    assert.equal(guard.maxDepth, 16);
    assert.equal(guard.maxNodes, 256);
    const metrics = guard.getMetrics();
    assert.equal(metrics.activeNodes, 0);
    assert.equal(metrics.activeEdges, 0);
    assert.equal(metrics.cyclesBlocked, 0);
  });

  it('rejects self-referential dependencies immediately', () => {
    const guard = new CyclicDependencyGuard();
    const res = guard.addDependency('task-1', 'task-1');

    assert.equal(res.allowed, false);
    assert.equal(res.action, GuardAction.REJECT_SELF_LOOP);
    assert.match(res.reason, /cannot depend on itself/);
    assert.equal(guard.getMetrics().selfLoopsBlocked, 1);
  });

  it('admits valid acyclic linear and branching workflows', () => {
    const guard = new CyclicDependencyGuard();

    // Pipeline: task-C depends on task-B, task-B depends on task-A
    assert.equal(guard.addDependency('task-C', 'task-B').allowed, true);
    assert.equal(guard.addDependency('task-B', 'task-A').allowed, true);

    // Diamond: task-D depends on task-B and task-C
    assert.equal(guard.addDependency('task-D', 'task-C').allowed, true);

    const metrics = guard.getMetrics();
    assert.equal(metrics.activeNodes, 4);
    assert.equal(metrics.activeEdges, 3);
    assert.equal(metrics.dependenciesAllowed, 3);

    // Valid topological sort: task-A must execute before task-B, task-B before task-C/D
    const order = guard.getTopologicalOrder();
    assert.equal(order.indexOf('task-A') < order.indexOf('task-B'), true);
    assert.equal(order.indexOf('task-B') < order.indexOf('task-C'), true);
  });

  it('detects and intercepts direct 2-node circular dependencies', () => {
    const cyclesLogged = [];
    const guard = new CyclicDependencyGuard({
      onCycleDetected: (cycle, meta) => cyclesLogged.push({ cycle, meta }),
    });

    // Node A depends on Node B
    assert.equal(guard.addDependency('A', 'B').allowed, true);

    // Node B attempts to depend on Node A (Cycle!)
    const cycleRes = guard.addDependency('B', 'A');
    assert.equal(cycleRes.allowed, false);
    assert.equal(cycleRes.action, GuardAction.QUARANTINE_CYCLE);
    assert.deepEqual(cycleRes.cyclePath, ['B', 'A', 'B']);
    assert.match(cycleRes.reason, /Cyclic workflow dependency detected/);

    assert.equal(guard.getMetrics().cyclesBlocked, 1);
    assert.equal(cyclesLogged.length, 1);
    assert.equal(cyclesLogged[0].meta.from, 'B');
    assert.equal(cyclesLogged[0].meta.to, 'A');
  });

  it('detects indirect multi-hop circular dependencies (A -> B -> C -> D -> A)', () => {
    const guard = new CyclicDependencyGuard();

    assert.equal(guard.addDependency('A', 'B').allowed, true);
    assert.equal(guard.addDependency('B', 'C').allowed, true);
    assert.equal(guard.addDependency('C', 'D').allowed, true);

    // D attempts to depend on A (closes cycle D -> A -> B -> C -> D)
    const cycleRes = guard.addDependency('D', 'A');
    assert.equal(cycleRes.allowed, false);
    assert.equal(cycleRes.action, GuardAction.QUARANTINE_CYCLE);
    assert.deepEqual(cycleRes.cyclePath, ['D', 'A', 'B', 'C', 'D']);
    assert.equal(guard.getMetrics().cyclesBlocked, 1);
  });

  it('enforces maximum dependency chain depth limits', () => {
    const guard = new CyclicDependencyGuard({ maxDepth: 3 });

    // Path depth: 1, 2, 3
    assert.equal(guard.addDependency('A', 'B').allowed, true);
    assert.equal(guard.addDependency('B', 'C').allowed, true);
    assert.equal(guard.addDependency('C', 'D').allowed, true);

    // E -> A would create a chain of length 4 > maxDepth 3
    const res = guard.addDependency('E', 'A');
    assert.equal(res.allowed, false);
    assert.equal(res.action, GuardAction.DEPTH_EXCEEDED);
    assert.equal(guard.getMetrics().depthViolations, 1);
  });

  it('supports dependency removal and state resets cleanly', () => {
    const guard = new CyclicDependencyGuard();

    guard.addDependency('task-1', 'task-2');
    assert.equal(guard.getMetrics().activeEdges, 1);

    assert.equal(guard.removeDependency('task-1', 'task-2'), true);
    assert.equal(guard.removeDependency('task-1', 'task-2'), false);
    assert.equal(guard.getMetrics().activeEdges, 0);

    guard.addDependency('task-X', 'task-Y');
    guard.reset();
    assert.equal(guard.getMetrics().activeNodes, 0);
    assert.equal(guard.getMetrics().activeEdges, 0);
  });
});
