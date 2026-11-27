export function benchmarkContextTrim(messages, maxLen = 10, iterations = 500) {
  const start = performance.now();
  let kept = 0;
  for (let i = 0; i < iterations; i++) {
    kept += messages.slice(-maxLen).length;
  }
  const sec = Math.max((performance.now() - start) / 1000, 1e-6);
  return { opsPerSec: Math.round((iterations + (kept & 0)) / sec) };
}
