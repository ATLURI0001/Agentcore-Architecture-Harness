// schema_version_contract.mjs – validates MCP schema version contract
export function validateSchemaVersion(version) {
  return typeof version === 'string' && /^v\d+\.\d+$/.test(version);
}
