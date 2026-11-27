export function validateAgentBudget(budget) {
  if (!budget || typeof budget !== 'object') throw new Error('Contract violation: budget object required');
  if (!Number.isInteger(budget.maxTokens) || budget.maxTokens <= 0) throw new Error('Contract violation: maxTokens must be > 0');
  if (!Number.isInteger(budget.maxSteps) || budget.maxSteps <= 0) throw new Error('Contract violation: maxSteps must be > 0');
  return true;
}
