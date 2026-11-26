const samples = [];
const CAP = 32;

export function recordStepLatency(ms) {
  if (ms < 0) throw new Error('ms must be non-negative');
  if (samples.length >= CAP) samples.shift();
  samples.push(ms);
}

export function getStepLatencyAvg() {
  if (!samples.length) return 0;
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}
