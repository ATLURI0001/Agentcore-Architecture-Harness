import assert from 'node:assert/strict';
import { validateAgentBudget } from './agent_budget_contract.mjs';

assert.equal(validateAgentBudget({ maxTokens: 4096, maxSteps: 10 }), true);
assert.throws(() => validateAgentBudget({ maxTokens: 0, maxSteps: 10 }));
console.log('PASS agent_budget_contract');
