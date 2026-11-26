import assert from 'node:assert/strict';
import { validateAgentHandoff } from './agent_handoff_contract.mjs';

assert.equal(validateAgentHandoff({ fromAgent: 'planner', toAgent: 'executor' }), true);
assert.throws(() => validateAgentHandoff({ fromAgent: 'planner', toAgent: 'planner' }));
console.log('PASS agent_handoff_contract');
