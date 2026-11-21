import assert from 'node:assert/strict';
import { ConsensusEngine, QuorumModel, BallotStatus } from './consensus_engine.mjs';

console.log('running consensus_engine unit tests...');

// 1. Majority Quorum
{
  const engine = new ConsensusEngine();
  const ballot = engine.proposeBallot('b1', 'deploy_model', ['agent_a', 'agent_b', 'agent_c']);

  assert.equal(ballot.status, BallotStatus.PROPOSED);

  // Agent A approves
  engine.castVote('b1', 'agent_a', true);
  assert.equal(ballot.status, BallotStatus.PROPOSED);

  // Agent B approves -> 2/3 majority reached
  const result = engine.castVote('b1', 'agent_b', true);
  assert.equal(result.status, BallotStatus.ACCEPTED);
  assert.equal(ballot.status, BallotStatus.ACCEPTED);
  console.log('ok   Majority Quorum accepts action on 2/3 votes');
}

// 2. Duplicate vote and ineligible agent rejection
{
  const engine = new ConsensusEngine();
  engine.proposeBallot('b2', 'write_db', ['agent_1', 'agent_2']);

  engine.castVote('b2', 'agent_1', true);
  assert.throws(() => engine.castVote('b2', 'agent_1', true), /already cast a vote/);
  assert.throws(() => engine.castVote('b2', 'agent_rogue', true), /not eligible/);
  console.log('ok   Rejects duplicate votes and rogue agents');
}

// 3. Supermajority Quorum
{
  const engine = new ConsensusEngine({ defaultModel: QuorumModel.SUPERMAJORITY });
  const ballot = engine.proposeBallot('b3', 'delete_cluster', ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);

  // 3 approvals out of 6 (50%) -> not enough for supermajority (>= 66.7%)
  engine.castVote('b3', 'a1', true);
  engine.castVote('b3', 'a2', true);
  engine.castVote('b3', 'a3', true);
  assert.equal(ballot.status, BallotStatus.PROPOSED);

  // 4th approval -> 4/6 = 66.7% -> Accepted
  const res = engine.castVote('b3', 'a4', true);
  assert.equal(res.status, BallotStatus.ACCEPTED);
  console.log('ok   Supermajority Quorum requires >= 2/3 threshold');
}

// 4. Weighted Voting
{
  const engine = new ConsensusEngine();
  const ballot = engine.proposeBallot('b4', 'transfer_treasury', ['chief', 'worker_1', 'worker_2'], {
    agentWeights: { chief: 5.0, worker_1: 1.0, worker_2: 1.0 },
  });

  // Chief votes yes (weight 5), worker_1 votes no (weight 1), worker_2 votes no (weight 1)
  // Total weight: 7. Approvals: 5/7 = 71.4%
  engine.castVote('b4', 'worker_1', false);
  engine.castVote('b4', 'worker_2', false);
  const res = engine.castVote('b4', 'chief', true);

  assert.equal(res.approveWeight, 5.0);
  assert.equal(res.rejectWeight, 2.0);
  assert.equal(res.status, BallotStatus.ACCEPTED);
  console.log('ok   Weighted Voting respects heterogeneous agent reputation scores');
}

// 5. Expiration Handling
{
  const engine = new ConsensusEngine({ timeoutMs: 10 });
  engine.proposeBallot('b5', 'quick_action', ['a1', 'a2']);

  setTimeout(() => {
    assert.throws(() => engine.castVote('b5', 'a1', true), /expired/);
    console.log('ok   Ballot expiration trips after timeoutMs');
    console.log('all consensus_engine unit tests passed successfully!');
  }, 25);
}
