const samples = [];
const CAP = 32;

export function recordTokenUsage(tokens) {
  if (tokens < 0) throw new Error('tokens must be non-negative');
  if (samples.length >= CAP) samples.shift();
  samples.push(tokens);
}

export function getAvgTokenUsage() {
  if (!samples.length) return 0;
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}
