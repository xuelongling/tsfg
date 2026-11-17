// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import registry from '../../contracts/registry.json' with {type:'json'};

const admitted = registry['tsfg.bytecode'];
const archived = {version:'0.9.0',bytecodeSchema:'sha256:3dea6ce5de996dfa3e7141cced985243ea74ac9bb80f03636c6694343118f2a6'};
export const moduleCallableExchange = {version:admitted.semver,bytecodeSchema:admitted.schemaHash};

/** @param {string} core */
export function currentModuleCallableCore(core) {
  const version = 'tsfg_core.version = "' + archived.version + '"';
  const schema = 'tsfg_core.bytecode_schema = "' + archived.bytecodeSchema + '"';
  const end = core.indexOf('\n');
  const header = core.slice(0, end);
  assert.ok(end > 0 && header.startsWith('module attributes {'));
  assert.equal(header.split(version).length, 2);
  assert.equal(header.split(schema).length, 2);
  return header.replace(version, 'tsfg_core.version = "' + moduleCallableExchange.version + '"')
    .replace(schema, 'tsfg_core.bytecode_schema = "' + moduleCallableExchange.bytecodeSchema + '"')
    + core.slice(end);
}
