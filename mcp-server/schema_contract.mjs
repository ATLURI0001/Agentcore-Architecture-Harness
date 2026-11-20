// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
// Schema contract validator and path sanitization module for AgentCore MCP server.

import path from "node:path";

/**
 * Validate input values against a JSON Schema contract.
 * @param {object} schema - JSON Schema definition
 * @param {any} input - Value to validate
 * @param {object} options - Validation options
 * @returns {{ valid: boolean, errors: Array<{ path: string, keyword: string, message: string }> }}
 */
export function validateSchemaContract(schema, input, options = {}) {
  const errors = [];
  _validateNode(schema, input, "$", errors, options);
  return {
    valid: errors.length === 0,
    errors,
  };
}

function _getType(val) {
  if (val === null) return "null";
  if (Array.isArray(val)) return "array";
  if (typeof val === "number") {
    return Number.isInteger(val) ? "integer" : "number";
  }
  return typeof val;
}

function _validateNode(schema, val, currentPath, errors, options) {
  if (!schema || typeof schema !== "object") return;

  const actualType = _getType(val);

  // Type check
  if (schema.type) {
    const expectedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    const matches = expectedTypes.some((t) => {
      if (t === "number" && actualType === "integer") return true;
      return actualType === t;
    });

    if (!matches) {
      errors.push({
        path: currentPath,
        keyword: "type",
        message: `Expected type ${expectedTypes.join(" | ")}, but received ${actualType}`,
      });
      return; // Stop further validation on type mismatch
    }
  }

  // Enum check
  if (Array.isArray(schema.enum)) {
    const inEnum = schema.enum.some((item) => item === val);
    if (!inEnum) {
      errors.push({
        path: currentPath,
        keyword: "enum",
        message: `Value must be one of [${schema.enum.map((e) => JSON.stringify(e)).join(", ")}]`,
      });
    }
  }

  // String constraints
  if (actualType === "string") {
    if (typeof schema.minLength === "number" && val.length < schema.minLength) {
      errors.push({
        path: currentPath,
        keyword: "minLength",
        message: `String length ${val.length} is less than minimum ${schema.minLength}`,
      });
    }
    if (typeof schema.maxLength === "number" && val.length > schema.maxLength) {
      errors.push({
        path: currentPath,
        keyword: "maxLength",
        message: `String length ${val.length} exceeds maximum ${schema.maxLength}`,
      });
    }
    if (schema.pattern) {
      const regex = typeof schema.pattern === "string" ? new RegExp(schema.pattern) : schema.pattern;
      if (!regex.test(val)) {
        errors.push({
          path: currentPath,
          keyword: "pattern",
          message: `String does not match required pattern ${schema.pattern}`,
        });
      }
    }
  }

  // Number / Integer constraints
  if (actualType === "number" || actualType === "integer") {
    if (typeof schema.minimum === "number" && val < schema.minimum) {
      errors.push({
        path: currentPath,
        keyword: "minimum",
        message: `Value ${val} is less than minimum ${schema.minimum}`,
      });
    }
    if (typeof schema.maximum === "number" && val > schema.maximum) {
      errors.push({
        path: currentPath,
        keyword: "maximum",
        message: `Value ${val} exceeds maximum ${schema.maximum}`,
      });
    }
  }

  // Array constraints
  if (actualType === "array") {
    if (typeof schema.minItems === "number" && val.length < schema.minItems) {
      errors.push({
        path: currentPath,
        keyword: "minItems",
        message: `Array length ${val.length} is less than minItems ${schema.minItems}`,
      });
    }
    if (typeof schema.maxItems === "number" && val.length > schema.maxItems) {
      errors.push({
        path: currentPath,
        keyword: "maxItems",
        message: `Array length ${val.length} exceeds maxItems ${schema.maxItems}`,
      });
    }
    if (schema.items) {
      for (let i = 0; i < val.length; i++) {
        _validateNode(schema.items, val[i], `${currentPath}[${i}]`, errors, options);
      }
    }
  }

  // Object constraints
  if (actualType === "object") {
    if (Array.isArray(schema.required)) {
      for (const reqKey of schema.required) {
        if (!(reqKey in val) || val[reqKey] === undefined) {
          errors.push({
            path: `${currentPath}.${reqKey}`,
            keyword: "required",
            message: `Required property '${reqKey}' is missing`,
          });
        }
      }
    }

    const properties = schema.properties || {};
    const knownKeys = new Set(Object.keys(properties));

    if (schema.additionalProperties === false) {
      for (const actualKey of Object.keys(val)) {
        if (!knownKeys.has(actualKey)) {
          errors.push({
            path: `${currentPath}.${actualKey}`,
            keyword: "additionalProperties",
            message: `Property '${actualKey}' is not allowed by contract`,
          });
        }
      }
    }

    for (const [key, propSchema] of Object.entries(properties)) {
      if (key in val && val[key] !== undefined) {
        _validateNode(propSchema, val[key], `${currentPath}.${key}`, errors, options);
      }
    }
  }
}

/**
 * Sanitize a file or resource path string against traversal and escape attempts.
 * @param {string} inputPath - User-supplied path string
 * @param {object} options - Configuration options
 * @param {string} [options.baseDir] - Mandatory root directory the path must reside in
 * @param {boolean} [options.allowAbsolute=false] - Whether absolute paths are permitted
 * @param {boolean} [options.allowWindowsDrive=false] - Whether drive letters are permitted
 * @returns {{ safe: boolean, sanitizedPath?: string, error?: string }}
 */
export function sanitizePath(inputPath, options = {}) {
  if (typeof inputPath !== "string" || !inputPath.trim()) {
    return { safe: false, error: "Path must be a non-empty string" };
  }

  // Check for null bytes (poison null byte attack)
  if (inputPath.includes("\0")) {
    return { safe: false, error: "Path contains invalid null byte sequence" };
  }

  // Normalized path representation
  const raw = inputPath.trim();

  // Check for path traversal segments (.. or /../ or \..\)
  const segments = raw.replace(/\\/g, "/").split("/");
  for (const seg of segments) {
    if (seg === "..") {
      return { safe: false, error: "Directory traversal sequences ('..') are strictly prohibited" };
    }
  }

  // Windows drive letter check
  const hasDrive = /^[a-zA-Z]:/.test(raw);
  if (hasDrive && !options.allowWindowsDrive) {
    return { safe: false, error: "Absolute drive letters are prohibited" };
  }

  // UNC paths (\\server\share)
  if (raw.startsWith("\\\\") || raw.startsWith("//")) {
    return { safe: false, error: "UNC / network paths are prohibited" };
  }

  // Check if baseDir is enforced
  if (options.baseDir) {
    const resolvedBase = path.resolve(options.baseDir);
    const resolvedTarget = path.resolve(resolvedBase, raw);

    const relative = path.relative(resolvedBase, resolvedTarget);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return {
        safe: false,
        error: `Path escapes base directory boundary: '${resolvedTarget}' not in '${resolvedBase}'`,
      };
    }

    return { safe: true, sanitizedPath: resolvedTarget };
  }

  // Disallow absolute root paths if not explicitly allowed
  if (!options.allowAbsolute && (path.isAbsolute(raw) || raw.startsWith("/") || raw.startsWith("\\"))) {
    return { safe: false, error: "Absolute paths are prohibited in this context" };
  }

  return { safe: true, sanitizedPath: path.normalize(raw) };
}

/**
 * Validate and sanitize an MCP resource URI.
 * @param {string} uri - Resource URI string (e.g. 'file:///app/config.json')
 * @param {string[]} [allowedSchemes=['file', 'memory', 'agent']]
 * @returns {{ safe: boolean, scheme?: string, pathname?: string, error?: string }}
 */
export function sanitizeResourceUri(uri, allowedSchemes = ["file", "memory", "agent"]) {
  if (typeof uri !== "string" || !uri.trim()) {
    return { safe: false, error: "Resource URI must be a non-empty string" };
  }

  if (uri.includes("\0") || uri.includes("..")) {
    return { safe: false, error: "URI contains traversal or null byte sequences" };
  }

  try {
    const parsed = new URL(uri);
    const scheme = parsed.protocol.replace(/:$/, "");
    if (!allowedSchemes.includes(scheme)) {
      return {
        safe: false,
        error: `URI scheme '${scheme}' is not allowed (must be one of: ${allowedSchemes.join(", ")})`,
      };
    }

    return {
      safe: true,
      scheme,
      pathname: parsed.pathname,
    };
  } catch (err) {
    return { safe: false, error: `Malformed URI format: ${err.message}` };
  }
}
