/**
 * INC-2026-AGENTCORE-6620: Unbounded Conversation Context Window Bloat Sentinel.
 * 
 * Monitors agent turn token accumulation, detects runaway tool output bloat,
 * and triggers deterministic compaction before context overflow crashes.
 */

export class ContextBloatSentinel {
  constructor(maxTokenBudget = 128000, singleTurnCapTokens = 16000) {
    this.maxTokenBudget = maxTokenBudget;
    this.singleTurnCapTokens = singleTurnCapTokens;
    this.currentTokens = 0;
    this.incidents = [];
  }

  inspectTurn(turnId, estimatedTokens) {
    if (estimatedTokens > this.singleTurnCapTokens) {
      this.incidents.push({ turnId, code: 'ERR_SINGLE_TURN_BLOAT', estimatedTokens });
      return {
        allowed: false,
        needsCompaction: true,
        reason: 'ERR_SINGLE_TURN_BLOAT',
      };
    }

    if (this.currentTokens + estimatedTokens > this.maxTokenBudget) {
      this.incidents.push({
        turnId,
        code: 'ERR_CONTEXT_WINDOW_OVERFLOW',
        projected: this.currentTokens + estimatedTokens,
      });
      return {
        allowed: false,
        needsCompaction: true,
        reason: 'ERR_CONTEXT_WINDOW_OVERFLOW',
      };
    }

    this.currentTokens += estimatedTokens;
    return { allowed: true, needsCompaction: false, currentTokens: this.currentTokens };
  }

  compact(retainedTokens) {
    this.currentTokens = Math.min(this.currentTokens, retainedTokens);
  }
}
