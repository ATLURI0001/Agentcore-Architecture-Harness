export function assertSafeToolArg(arg) {
  if (typeof arg === 'string' && /[;&|`$]/.test(arg)) {
    throw new Error('Sentinel violation: shell metacharacters prohibited in tool argument');
  }
}
