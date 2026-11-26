export function validateToolResult(result) {
  if (!result || typeof result !== 'object') throw new Error('Contract violation: result object required');
  if (typeof result.isError !== 'boolean') throw new Error('Contract violation: boolean isError required');
  if (!Array.isArray(result.content)) throw new Error('Contract violation: content array required');
  return true;
}
