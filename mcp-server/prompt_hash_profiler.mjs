import { createHash } from 'node:crypto';

export function benchmarkPromptHash(prompt, iterations = 500) {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    createHash('sha256').update(prompt).digest('hex');
  }
  const sec = Math.max((performance.now() - start) / 1000, 1e-6);
  return { opsPerSec: Math.round(iterations / sec) };
}
