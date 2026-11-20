// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
// Unit tests for schema contract and path sanitization.

import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { sanitizePath, sanitizeResourceUri, validateSchemaContract } from "./schema_contract.mjs";

console.log("running schema_contract tests...");

// 1. Schema Contract Validation Tests
{
  const schema = {
    type: "object",
    required: ["name", "rating"],
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 2, maxLength: 50 },
      rating: { type: "integer", minimum: 1, maximum: 5 },
      tags: {
        type: "array",
        items: { type: "string" },
        maxItems: 5,
      },
      status: {
        type: "string",
        enum: ["active", "archived", "pending"],
      },
    },
  };

  // Valid payload
  const validPayload = {
    name: "ArchitecturalReview",
    rating: 5,
    tags: ["aws", "bedrock", "agentcore"],
    status: "active",
  };
  const validRes = validateSchemaContract(schema, validPayload);
  assert.equal(validRes.valid, true, "Valid payload should pass contract");
  assert.equal(validRes.errors.length, 0);

  // Missing required property
  const missingRes = validateSchemaContract(schema, { name: "Audit" });
  assert.equal(missingRes.valid, false);
  assert.ok(missingRes.errors.some((e) => e.keyword === "required" && e.path === "$.rating"));

  // Out of range integer
  const rangeRes = validateSchemaContract(schema, { name: "Audit", rating: 99 });
  assert.equal(rangeRes.valid, false);
  assert.ok(rangeRes.errors.some((e) => e.keyword === "maximum"));

  // Disallowed additional property
  const extraRes = validateSchemaContract(schema, { name: "Audit", rating: 3, hack: true });
  assert.equal(extraRes.valid, false);
  assert.ok(extraRes.errors.some((e) => e.keyword === "additionalProperties"));

  // Invalid enum
  const enumRes = validateSchemaContract(schema, { name: "Audit", rating: 3, status: "destroyed" });
  assert.equal(enumRes.valid, false);
  assert.ok(enumRes.errors.some((e) => e.keyword === "enum"));
}

// 2. Path Sanitization Tests
{
  // Null byte injection
  const nullByte = sanitizePath("normal/file\0.txt");
  assert.equal(nullByte.safe, false);
  assert.ok(nullByte.error.includes("null byte"));

  // Traversal attack
  const traversal = sanitizePath("../../../etc/shadow");
  assert.equal(traversal.safe, false);
  assert.ok(traversal.error.includes("traversal"));

  // Traversal embedded
  const embeddedTraversal = sanitizePath("safe/path/../../escape.txt");
  assert.equal(embeddedTraversal.safe, false);

  // Base directory containment
  const tmpRoot = os.tmpdir();
  const safeContained = sanitizePath("subfolder/file.json", { baseDir: tmpRoot });
  assert.equal(safeContained.safe, true);
  assert.ok(safeContained.sanitizedPath.startsWith(path.resolve(tmpRoot)));

  // Escaping baseDir
  const escapeAttempt = sanitizePath("../external.txt", { baseDir: tmpRoot });
  assert.equal(escapeAttempt.safe, false);

  // Disallowing drive letters by default
  const winDrive = sanitizePath("C:\\Windows\\System32\\cmd.exe", { allowWindowsDrive: false });
  assert.equal(winDrive.safe, false);
}

// 3. Resource URI Sanitization Tests
{
  const safeUri = sanitizeResourceUri("file:///var/log/app.log", ["file"]);
  assert.equal(safeUri.safe, true);
  assert.equal(safeUri.scheme, "file");

  const disallowedScheme = sanitizeResourceUri("http://malicious.site/data", ["file", "memory"]);
  assert.equal(disallowedScheme.safe, false);
  assert.ok(disallowedScheme.error.includes("scheme 'http' is not allowed"));

  const traversalUri = sanitizeResourceUri("file:///app/../etc/passwd", ["file"]);
  assert.equal(traversalUri.safe, false);
  assert.ok(traversalUri.error.includes("traversal"));
}

console.log("all schema_contract unit tests passed successfully!");
