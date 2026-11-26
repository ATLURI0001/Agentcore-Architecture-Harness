export function validateAgentHandoff(handoff) {
  if (!handoff || typeof handoff !== 'object') {
    throw new Error('Contract violation: handoff payload must be an object');
  }
  if (!handoff.fromAgent || typeof handoff.fromAgent !== 'string') {
    throw new Error('Contract violation: fromAgent is required');
  }
  if (!handoff.toAgent || typeof handoff.toAgent !== 'string') {
    throw new Error('Contract violation: toAgent is required');
  }
  if (handoff.fromAgent === handoff.toAgent) {
    throw new Error('Contract violation: self-handoff is prohibited');
  }
  return true;
}
