// agentcore-architecture-harness: config change sentinel
export function validateConfigChange(change) {
  if (!change || typeof change !== 'object') throw new Error('config change must be an object');
  if (!change.key || typeof change.key !== 'string') throw new Error('config change must have a string key');
  if (!('value' in change)) throw new Error('config change must have a value');
}
