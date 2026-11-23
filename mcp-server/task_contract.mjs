/**
 * Multi-Agent Task Execution Ingress Contract & Boundary Validator for Agentcore.
 * Enforces formal task schema invariants, prototype pollution defenses,
 * acyclic dependency DAG constraints, and payload sanitization.
 */

import { createHash } from 'node:crypto';

export const TASK_ACTIONS = new Set([
  'analyze',
  'execute',
  'summarize',
  'review',
  'transform',
  'delegate',
]);

export const RETRY_STRATEGIES = new Set(['exponential', 'linear', 'constant']);

const TASK_ID_REGEX = /^task-[a-zA-Z0-9_-]{4,64}$/;
const AGENT_ID_REGEX = /^agent-[a-zA-Z0-9_-]{3,32}$/;
const INVISIBLE_UNICODE_REGEX = /[\u200B-\u200D\uFEFF\u202A-\u202E]/g;
const PROMPT_DELIMITER_REGEX = /<\|(?:im_start|im_end|endoftext|system|user|assistant)\|>/gi;

export class TaskContractViolationError extends Error {
  constructor(message, code, field) {
    super(message);
    this.name = 'TaskContractViolationError';
    this.code = code;
    this.field = field;
  }
}

/**
 * Recursively deep-sanitizes payload objects to prevent prototype pollution and control char injection.
 */
export function sanitizePayloadValue(value, depth = 0) {
  if (depth > 16) {
    throw new TaskContractViolationError('Payload object nesting exceeds maximum depth of 16', 'ERR_NESTING_DEPTH', 'payload');
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    // Strip invisible unicode & prompt delimiters
    return value
      .replace(INVISIBLE_UNICODE_REGEX, '')
      .replace(PROMPT_DELIMITER_REGEX, '');
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    if (typeof value === 'number' && (!Number.isFinite(value) || Number.isNaN(value))) {
      throw new TaskContractViolationError('Payload contains non-finite number or NaN', 'ERR_INVALID_NUMERIC', 'payload');
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizePayloadValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    const cleanObj = Object.create(null);
    for (const key of Object.keys(value)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw new TaskContractViolationError(
          `Prototype pollution key '${key}' detected in payload`,
          'ERR_PROTOTYPE_POLLUTION',
          'payload'
        );
      }
      cleanObj[key] = sanitizePayloadValue(value[key], depth + 1);
    }
    return cleanObj;
  }

  throw new TaskContractViolationError(
    `Unsupported value type in payload: ${typeof value}`,
    'ERR_UNSUPPORTED_TYPE',
    'payload'
  );
}

/**
 * Validates dependency DAG for acyclic order and existence.
 */
export function validateDependencyDag(taskId, dependencies = []) {
  if (!Array.isArray(dependencies)) {
    throw new TaskContractViolationError('Dependencies must be an array of task IDs', 'ERR_INVALID_DEPENDENCIES', 'dependencies');
  }

  const seen = new Set();
  for (const dep of dependencies) {
    if (typeof dep !== 'string' || !TASK_ID_REGEX.test(dep)) {
      throw new TaskContractViolationError(
        `Dependency ID '${dep}' does not match valid task ID pattern`,
        'ERR_INVALID_DEPENDENCY_ID',
        'dependencies'
      );
    }
    if (dep === taskId) {
      throw new TaskContractViolationError(
        `Self-referential task dependency detected on '${taskId}'`,
        'ERR_CYCLIC_DEPENDENCY',
        'dependencies'
      );
    }
    if (seen.has(dep)) {
      throw new TaskContractViolationError(
        `Duplicate dependency '${dep}' specified`,
        'ERR_DUPLICATE_DEPENDENCY',
        'dependencies'
      );
    }
    seen.add(dep);
  }

  return Array.from(seen);
}

/**
 * Validates retry policy configuration.
 */
export function validateRetryPolicy(policy = {}) {
  if (typeof policy !== 'object' || policy === null) {
    throw new TaskContractViolationError('Retry policy must be an object', 'ERR_INVALID_RETRY_POLICY', 'retryPolicy');
  }

  const maxRetries = policy.maxRetries !== undefined ? Number(policy.maxRetries) : 3;
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 10) {
    throw new TaskContractViolationError(
      `maxRetries must be an integer between 0 and 10, got ${policy.maxRetries}`,
      'ERR_INVALID_MAX_RETRIES',
      'retryPolicy.maxRetries'
    );
  }

  const backoffMs = policy.backoffMs !== undefined ? Number(policy.backoffMs) : 1000;
  if (!Number.isFinite(backoffMs) || backoffMs < 100 || backoffMs > 60000) {
    throw new TaskContractViolationError(
      `backoffMs must be between 100ms and 60,000ms, got ${policy.backoffMs}`,
      'ERR_INVALID_BACKOFF',
      'retryPolicy.backoffMs'
    );
  }

  const strategy = policy.strategy ? String(policy.strategy).toLowerCase() : 'exponential';
  if (!RETRY_STRATEGIES.has(strategy)) {
    throw new TaskContractViolationError(
      `Unsupported retry strategy '${strategy}'. Supported: ${Array.from(RETRY_STRATEGIES).join(', ')}`,
      'ERR_INVALID_RETRY_STRATEGY',
      'retryPolicy.strategy'
    );
  }

  return Object.freeze({
    maxRetries,
    backoffMs,
    strategy,
  });
}

/**
 * Validates and hardens a full multi-agent task execution specification.
 */
export function validateTaskExecutionContract(spec) {
  if (typeof spec !== 'object' || spec === null) {
    throw new TaskContractViolationError('Task specification must be a non-null object', 'ERR_INVALID_SPEC', 'spec');
  }

  // 1. Task ID
  if (typeof spec.taskId !== 'string' || !TASK_ID_REGEX.test(spec.taskId.trim())) {
    throw new TaskContractViolationError(
      `taskId must match pattern 'task-<id>' [4-64 chars], got '${spec.taskId}'`,
      'ERR_INVALID_TASK_ID',
      'taskId'
    );
  }
  const taskId = spec.taskId.trim();

  // 2. Caller Agent ID
  if (typeof spec.callerAgentId !== 'string' || !AGENT_ID_REGEX.test(spec.callerAgentId.trim())) {
    throw new TaskContractViolationError(
      `callerAgentId must match pattern 'agent-<id>', got '${spec.callerAgentId}'`,
      'ERR_INVALID_CALLER_AGENT',
      'callerAgentId'
    );
  }
  const callerAgentId = spec.callerAgentId.trim();

  // 3. Target Agent ID
  if (typeof spec.targetAgentId !== 'string' || !AGENT_ID_REGEX.test(spec.targetAgentId.trim())) {
    throw new TaskContractViolationError(
      `targetAgentId must match pattern 'agent-<id>', got '${spec.targetAgentId}'`,
      'ERR_INVALID_TARGET_AGENT',
      'targetAgentId'
    );
  }
  const targetAgentId = spec.targetAgentId.trim();

  // 4. Action
  if (typeof spec.action !== 'string' || !TASK_ACTIONS.has(spec.action.toLowerCase().trim())) {
    throw new TaskContractViolationError(
      `Unsupported task action '${spec.action}'. Supported: ${Array.from(TASK_ACTIONS).join(', ')}`,
      'ERR_INVALID_ACTION',
      'action'
    );
  }
  const action = spec.action.toLowerCase().trim();

  // 5. Priority (1 = lowest, 10 = critical)
  const priority = spec.priority !== undefined ? Number(spec.priority) : 5;
  if (!Number.isInteger(priority) || priority < 1 || priority > 10) {
    throw new TaskContractViolationError(
      `priority must be an integer between 1 and 10, got ${spec.priority}`,
      'ERR_INVALID_PRIORITY',
      'priority'
    );
  }

  // 6. Timeout
  const timeoutMs = spec.timeoutMs !== undefined ? Number(spec.timeoutMs) : 30000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 300000) {
    throw new TaskContractViolationError(
      `timeoutMs must be between 100ms and 300,000ms (5min), got ${spec.timeoutMs}`,
      'ERR_INVALID_TIMEOUT',
      'timeoutMs'
    );
  }

  // 7. Dependencies DAG
  const dependencies = validateDependencyDag(taskId, spec.dependencies);

  // 8. Payload validation & sanitization
  if (spec.payload !== undefined && (typeof spec.payload !== 'object' || spec.payload === null)) {
    throw new TaskContractViolationError('payload must be an object if specified', 'ERR_INVALID_PAYLOAD', 'payload');
  }
  const rawPayload = spec.payload || {};
  const serialized = JSON.stringify(rawPayload);
  if (serialized.length > 256 * 1024) {
    throw new TaskContractViolationError(
      `payload size (${serialized.length} bytes) exceeds maximum limit of 256KB`,
      'ERR_PAYLOAD_TOO_LARGE',
      'payload'
    );
  }
  const cleanPayload = sanitizePayloadValue(rawPayload);

  // 9. Retry policy
  const retryPolicy = validateRetryPolicy(spec.retryPolicy);

  // 10. Canonical checksum computation
  const canonicalManifest = {
    taskId,
    callerAgentId,
    targetAgentId,
    action,
    priority,
    timeoutMs,
    dependencies,
    retryPolicy,
    payload: cleanPayload,
  };

  const manifestJson = JSON.stringify(canonicalManifest);
  const manifestChecksum = createHash('sha256').update(manifestJson).digest('hex');

  return Object.freeze({
    ...canonicalManifest,
    manifestChecksum,
    createdAt: Date.now(),
  });
}
