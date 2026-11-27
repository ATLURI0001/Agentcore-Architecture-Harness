// agentcore-architecture-harness: event dispatch sentinel
export function validateEvent(evt) {
  if (!evt || typeof evt.type !== 'string' || !evt.type.trim()) {
    throw new Error('invalid event: missing type');
  }
}
