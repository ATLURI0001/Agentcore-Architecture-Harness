/**
 * Agent Session Context Ingress Contract & Message Sanitizer for Agentcore.
 * Enforces schema validation, role sequencing invariants, control character stripping,
 * and prompt delimiter injection defenses.
 */

export const SUPPORTED_MODELS = new Set([
  'gemini-1.5-pro',
  'gemini-1.5-flash',
  'gemini-2.0-flash',
  'claude-3-5-sonnet',
  'gpt-4o',
]);

const SESSION_ID_REGEX = /^sess-[a-zA-Z0-9_-]{1,64}$/;
const AGENT_ID_REGEX = /^agent-[a-zA-Z0-9_-]{1,32}$/;
const INVISIBLE_UNICODE_REGEX = /[\u200B-\u200D\uFEFF\u202A-\u202E]/g;
const PROMPT_DELIMITER_REGEX = /<\|(?:im_start|im_end|endoftext|system|user|assistant)\|>/gi;

/**
 * Validates and normalizes an agent session creation spec.
 */
export function validateSessionSpec(spec) {
  if (typeof spec !== 'object' || spec === null) {
    throw new Error('Session specification must be a non-null object');
  }

  // sessionId validation
  if (typeof spec.sessionId !== 'string' || !SESSION_ID_REGEX.test(spec.sessionId.trim())) {
    throw new Error(`sessionId must match pattern 'sess-<id>' [4-64 chars], got '${spec.sessionId}'`);
  }
  const sessionId = spec.sessionId.trim();

  // agentId validation
  if (typeof spec.agentId !== 'string' || !AGENT_ID_REGEX.test(spec.agentId.trim())) {
    throw new Error(`agentId must match pattern 'agent-<id>' [3-32 chars], got '${spec.agentId}'`);
  }
  const agentId = spec.agentId.trim();

  // model validation
  if (typeof spec.model !== 'string' || !SUPPORTED_MODELS.has(spec.model.trim())) {
    throw new Error(`Unsupported model '${spec.model}'. Supported: ${Array.from(SUPPORTED_MODELS).join(', ')}`);
  }
  const model = spec.model.trim();

  // maxTokens validation
  const maxTokens = Number(spec.maxTokens) || 4096;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 128000) {
    throw new Error(`maxTokens must be an integer between 1 and 128,000, got ${spec.maxTokens}`);
  }

  // temperature validation
  const temp = spec.temperature !== undefined ? Number(spec.temperature) : 0.7;
  if (!Number.isFinite(temp) || temp < 0.0 || temp > 2.0) {
    throw new Error(`temperature must be a float between 0.0 and 2.0, got ${spec.temperature}`);
  }

  // systemPrompt sanitization
  let systemPrompt = '';
  if (spec.systemPrompt !== undefined) {
    if (typeof spec.systemPrompt !== 'string') {
      throw new Error('systemPrompt must be a string');
    }
    systemPrompt = sanitizeMessageContent(spec.systemPrompt);
    if (systemPrompt.length > 32768) {
      throw new Error(`systemPrompt exceeds maximum length of 32,768 characters (${systemPrompt.length})`);
    }
  }

  return {
    sessionId,
    agentId,
    model,
    maxTokens,
    temperature: Number(temp.toFixed(2)),
    systemPrompt,
  };
}

/**
 * Strips zero-width runes, BiDi controls, and special token delimiter injection strings.
 */
export function sanitizeMessageContent(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(INVISIBLE_UNICODE_REGEX, '')
    .replace(PROMPT_DELIMITER_REGEX, '[STRIPPED_TOKEN]')
    .trim();
}

/**
 * Validates a single turn message spec.
 */
export function validateMessageSpec(msg) {
  if (typeof msg !== 'object' || msg === null) {
    throw new Error('Message specification must be a non-null object');
  }

  const validRoles = new Set(['system', 'user', 'assistant', 'tool']);
  if (!validRoles.has(msg.role)) {
    throw new Error(`Invalid message role '${msg.role}'. Must be one of: system, user, assistant, tool`);
  }

  const role = msg.role;
  const content = sanitizeMessageContent(msg.content || '');

  if (!content && role !== 'assistant') {
    throw new Error(`Message content cannot be empty for role '${role}'`);
  }

  const result = {
    role,
    content,
    timestamp: Number(msg.timestamp) || Date.now(),
  };

  if (role === 'tool') {
    if (typeof msg.toolCallId !== 'string' || !msg.toolCallId.trim()) {
      throw new Error("toolCallId is required when message role is 'tool'");
    }
    result.toolCallId = msg.toolCallId.trim();
  }

  if (Array.isArray(msg.toolCalls)) {
    result.toolCalls = msg.toolCalls.map((tc) => {
      if (typeof tc.id !== 'string' || !tc.id.trim()) {
        throw new Error('Each toolCall must possess a valid id');
      }
      if (typeof tc.name !== 'string' || !tc.name.trim()) {
        throw new Error('Each toolCall must possess a valid name');
      }
      return {
        id: tc.id.trim(),
        name: tc.name.trim(),
        arguments: typeof tc.arguments === 'object' && tc.arguments !== null ? tc.arguments : {},
      };
    });
  }

  return result;
}

/**
 * Validates a sequence of messages for conversational state invariants.
 */
export function validateMessageHistory(messages) {
  if (!Array.isArray(messages)) {
    throw new Error('Message history must be an array of messages');
  }

  const validated = messages.map(validateMessageSpec);

  // Check tool call response pairing
  const pendingToolCallIds = new Set();

  for (const m of validated) {
    if (m.role === 'assistant' && m.toolCalls) {
      for (const tc of m.toolCalls) {
        pendingToolCallIds.add(tc.id);
      }
    } else if (m.role === 'tool') {
      if (!pendingToolCallIds.has(m.toolCallId)) {
        throw new Error(`Unmatched tool response: toolCallId '${m.toolCallId}' does not correspond to an active tool call`);
      }
      pendingToolCallIds.delete(m.toolCallId);
    }
  }

  return validated;
}
