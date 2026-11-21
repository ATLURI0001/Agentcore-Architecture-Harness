/**
 * Agentcore-Architecture-Harness: Multi-Agent Consensus Agreement Engine & Byzantine Fault Quorum
 * Implements majority, supermajority, and BFT quorum evaluation with weighted voting.
 */

export const QuorumModel = {
  MAJORITY: 'majority',
  SUPERMAJORITY: 'supermajority',
  BYZANTINE: 'byzantine',
};

export const BallotStatus = {
  PROPOSED: 'proposed',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
};

export class ConsensusEngine {
  /**
   * @param {Object} options
   * @param {string} [options.defaultModel='majority']
   * @param {number} [options.timeoutMs=60000]
   */
  constructor(options = {}) {
    this.defaultModel = options.defaultModel || QuorumModel.MAJORITY;
    this.timeoutMs = options.timeoutMs || 60000;
    this.ballots = new Map();
    this.telemetry = {
      ballotsProposed: 0,
      ballotsAccepted: 0,
      ballotsRejected: 0,
      ballotsExpired: 0,
      votesCast: 0,
    };
  }

  /**
   * Proposes a new action ballot for agent consensus voting.
   * @param {string} ballotId
   * @param {string} action
   * @param {string[]} eligibleAgents
   * @param {Object} [options={}]
   */
  proposeBallot(ballotId, action, eligibleAgents, options = {}) {
    if (!ballotId || typeof ballotId !== 'string') {
      throw new Error('ConsensusEngine: ballotId must be a non-empty string');
    }
    if (this.ballots.has(ballotId)) {
      throw new Error(`ConsensusEngine: ballotId '${ballotId}' already exists`);
    }
    if (!Array.isArray(eligibleAgents) || eligibleAgents.length === 0) {
      throw new Error('ConsensusEngine: eligibleAgents must be a non-empty array');
    }

    const quorumModel = options.quorumModel || this.defaultModel;
    const timeoutMs = options.timeoutMs || this.timeoutMs;
    const agentWeights = options.agentWeights || {};

    const ballot = {
      ballotId,
      action,
      eligibleAgents: new Set(eligibleAgents),
      quorumModel,
      agentWeights,
      votes: new Map(), // agentId -> { approve: boolean, weight: number }
      status: BallotStatus.PROPOSED,
      createdAt: Date.now(),
      expiresAt: Date.now() + timeoutMs,
      resolvedAt: null,
    };

    this.ballots.set(ballotId, ballot);
    this.telemetry.ballotsProposed++;
    return ballot;
  }

  /**
   * Casts an approval or rejection vote for an eligible agent.
   * @param {string} ballotId
   * @param {string} agentId
   * @param {boolean} approve
   * @param {number} [weight=1.0]
   */
  castVote(ballotId, agentId, approve, weight = 1.0) {
    const ballot = this.ballots.get(ballotId);
    if (!ballot) {
      throw new Error(`ConsensusEngine: ballot '${ballotId}' not found`);
    }
    if (ballot.status !== BallotStatus.PROPOSED) {
      throw new Error(`ConsensusEngine: ballot '${ballotId}' is not in PROPOSED state`);
    }
    if (Date.now() > ballot.expiresAt) {
      ballot.status = BallotStatus.EXPIRED;
      this.telemetry.ballotsExpired++;
      throw new Error(`ConsensusEngine: ballot '${ballotId}' has expired`);
    }
    if (!ballot.eligibleAgents.has(agentId)) {
      throw new Error(`ConsensusEngine: agent '${agentId}' is not eligible to vote on ballot '${ballotId}'`);
    }
    if (ballot.votes.has(agentId)) {
      throw new Error(`ConsensusEngine: agent '${agentId}' has already cast a vote on ballot '${ballotId}'`);
    }

    const effectiveWeight = Math.max(0.1, ballot.agentWeights[agentId] ?? (Number(weight) || 1.0));
    ballot.votes.set(agentId, { approve: Boolean(approve), weight: effectiveWeight });
    this.telemetry.votesCast++;

    // Re-tally to see if threshold reached
    return this.tallyBallot(ballotId);
  }

  /**
   * Tallies the ballot and determines consensus verdict.
   * @param {string} ballotId
   */
  tallyBallot(ballotId) {
    const ballot = this.ballots.get(ballotId);
    if (!ballot) {
      throw new Error(`ConsensusEngine: ballot '${ballotId}' not found`);
    }

    if (ballot.status !== BallotStatus.PROPOSED) {
      return { status: ballot.status, ballot };
    }

    if (Date.now() > ballot.expiresAt) {
      ballot.status = BallotStatus.EXPIRED;
      this.telemetry.ballotsExpired++;
      return { status: BallotStatus.EXPIRED, ballot };
    }

    const totalEligible = ballot.eligibleAgents.size;
    let approveWeight = 0;
    let rejectWeight = 0;
    let totalCastWeight = 0;

    for (const vote of ballot.votes.values()) {
      totalCastWeight += vote.weight;
      if (vote.approve) {
        approveWeight += vote.weight;
      } else {
        rejectWeight += vote.weight;
      }
    }

    let requiredRatio = 0.5; // default majority (> 50%)
    if (ballot.quorumModel === QuorumModel.SUPERMAJORITY) {
      requiredRatio = 2.0 / 3.0; // >= 66.67%
    } else if (ballot.quorumModel === QuorumModel.BYZANTINE) {
      // 3f + 1 <= N -> f < N/3 -> required approvals >= (2N + 1)/3
      requiredRatio = (2 * totalEligible + 1) / (3 * totalEligible);
    }

    const votesCastCount = ballot.votes.size;
    const approvalRatio = totalCastWeight > 0 ? approveWeight / totalCastWeight : 0;

    // Check if enough approvals gathered
    if (votesCastCount > 0) {
      if (ballot.quorumModel === QuorumModel.MAJORITY && approveWeight > totalCastWeight * 0.5 && votesCastCount > totalEligible / 2) {
        ballot.status = BallotStatus.ACCEPTED;
        ballot.resolvedAt = Date.now();
        this.telemetry.ballotsAccepted++;
      } else if (ballot.quorumModel === QuorumModel.SUPERMAJORITY && approvalRatio >= (2.0 / 3.0) && votesCastCount >= Math.ceil(totalEligible * (2.0 / 3.0))) {
        ballot.status = BallotStatus.ACCEPTED;
        ballot.resolvedAt = Date.now();
        this.telemetry.ballotsAccepted++;
      } else if (ballot.quorumModel === QuorumModel.BYZANTINE && approvalRatio >= requiredRatio && votesCastCount >= Math.ceil(totalEligible * requiredRatio)) {
        ballot.status = BallotStatus.ACCEPTED;
        ballot.resolvedAt = Date.now();
        this.telemetry.ballotsAccepted++;
      } else if (rejectWeight >= totalCastWeight * (1.0 - requiredRatio) && votesCastCount === totalEligible) {
        ballot.status = BallotStatus.REJECTED;
        ballot.resolvedAt = Date.now();
        this.telemetry.ballotsRejected++;
      }
    }

    return {
      status: ballot.status,
      approveWeight,
      rejectWeight,
      totalCastWeight,
      votesCastCount,
      totalEligible,
      approvalRatio,
      ballot,
    };
  }

  getTelemetry() {
    return { ...this.telemetry };
  }
}
