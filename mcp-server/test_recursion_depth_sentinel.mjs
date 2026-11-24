import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RecursionDepthSentinel,
  RecursionDepthExceededError,
  DelegationCycleDetectedError,
  BranchingFactorExceededError,
} from './recursion_depth_sentinel.mjs';

describe('RecursionDepthSentinel Suite', () => {
  it('allows nominal subagent delegation within depth and branching bounds', () => {
    const sentinel = new RecursionDepthSentinel({ maxDepth: 4, maxBranching: 3 });

    // Root -> Agent-A -> Agent-B
    const root = sentinel.enterSpan({
      spanId: 'span-1',
      agentId: 'user-proxy',
      subagentId: 'planner-agent',
    });
    assert.equal(root.depth, 1);
    assert.deepEqual(root.callStack, ['planner-agent']);

    const child = sentinel.enterSpan({
      spanId: 'span-2',
      parentSpanId: 'span-1',
      agentId: 'planner-agent',
      subagentId: 'researcher-agent',
    });
    assert.equal(child.depth, 2);
    assert.deepEqual(child.callStack, ['planner-agent', 'researcher-agent']);

    assert.equal(sentinel.getCallStack('span-2').length, 2);

    // Exit child span
    const closed = sentinel.exitSpan('span-2');
    assert.equal(closed.status, 'COMPLETED');
    assert.equal(sentinel.getMetrics().activeSpans, 1);
  });

  it('rejects delegation exceeding maximum recursion depth', () => {
    const sentinel = new RecursionDepthSentinel({ maxDepth: 3 });

    sentinel.enterSpan({ spanId: 's1', agentId: 'root', subagentId: 'a1' }); // depth 1
    sentinel.enterSpan({ spanId: 's2', parentSpanId: 's1', agentId: 'a1', subagentId: 'a2' }); // depth 2
    sentinel.enterSpan({ spanId: 's3', parentSpanId: 's2', agentId: 'a2', subagentId: 'a3' }); // depth 3

    assert.throws(
      () => {
        sentinel.enterSpan({ spanId: 's4', parentSpanId: 's3', agentId: 'a3', subagentId: 'a4' });
      },
      (err) => {
        assert.ok(err instanceof RecursionDepthExceededError);
        assert.ok(err.message.includes('exceeds maximum limit of 3'));
        return true;
      }
    );

    assert.equal(sentinel.getMetrics().depthViolations, 1);
  });

  it('detects and intercepts cyclic delegation loops', () => {
    const sentinel = new RecursionDepthSentinel({ maxDepth: 10, allowCycles: false });

    sentinel.enterSpan({ spanId: 's1', agentId: 'coordinator', subagentId: 'coder' });
    sentinel.enterSpan({ spanId: 's2', parentSpanId: 's1', agentId: 'coder', subagentId: 'reviewer' });

    // Reviewer delegates back to coder -> Cycle!
    assert.throws(
      () => {
        sentinel.enterSpan({ spanId: 's3', parentSpanId: 's2', agentId: 'reviewer', subagentId: 'coder' });
      },
      (err) => {
        assert.ok(err instanceof DelegationCycleDetectedError);
        assert.ok(err.message.includes("already present in call chain [coder -> reviewer]"));
        return true;
      }
    );

    assert.equal(sentinel.getMetrics().cycleViolations, 1);
  });

  it('enforces maximum branching factor per parent span', () => {
    const sentinel = new RecursionDepthSentinel({ maxBranching: 2 });

    sentinel.enterSpan({ spanId: 'p1', agentId: 'root', subagentId: 'orchestrator' });
    sentinel.enterSpan({ spanId: 'c1', parentSpanId: 'p1', agentId: 'orchestrator', subagentId: 'sub-1' });
    sentinel.enterSpan({ spanId: 'c2', parentSpanId: 'p1', agentId: 'orchestrator', subagentId: 'sub-2' });

    // 3rd concurrent child exceeds maxBranching: 2
    assert.throws(
      () => {
        sentinel.enterSpan({ spanId: 'c3', parentSpanId: 'p1', agentId: 'orchestrator', subagentId: 'sub-3' });
      },
      (err) => {
        assert.ok(err instanceof BranchingFactorExceededError);
        assert.ok(err.message.includes('exceeded max branching factor of 2'));
        return true;
      }
    );

    assert.equal(sentinel.getMetrics().branchingViolations, 1);
  });

  it('tolerates cycles when explicitly permitted', () => {
    const sentinel = new RecursionDepthSentinel({ maxDepth: 5, allowCycles: true });

    sentinel.enterSpan({ spanId: 's1', agentId: 'coord', subagentId: 'worker' });
    const s2 = sentinel.enterSpan({ spanId: 's2', parentSpanId: 's1', agentId: 'worker', subagentId: 'worker' });
    assert.equal(s2.depth, 2);
  });
});
