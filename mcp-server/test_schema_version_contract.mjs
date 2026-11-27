import assert from 'node:assert/strict';
import { validateSchemaVersion } from './schema_version_contract.mjs';

assert.equal(validateSchemaVersion('v1.2'), true);
assert.equal(validateSchemaVersion('1.2'), false);
console.log('PASS schema_version_contract');
