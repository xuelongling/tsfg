// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflowPath = path.join(repositoryRoot, ".github", "workflows", "ecp-governance.yml");

test("ECP governance executes only the trusted base gate without checking out candidate code", async () => {
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /^on:\n  pull_request_target:\s*$/m);
  assert.match(source, /^permissions:\n  contents: read\s*$/m);
  assert.match(source, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(source, /git show "\$TSFG_BASE_SHA:eng\/ecp-gate\.mjs" > "\$trusted_gate"/);
  assert.match(source, /node "\$trusted_gate"/);
  assert.match(source, /refs\/pull\/\$TSFG_PR_NUMBER\/head:refs\/tsfg\/ecp-candidate/);
  assert.match(source, /test "\$\(git rev-parse refs\/tsfg\/ecp-candidate\)" = "\$TSFG_HEAD_SHA"/);
  assert.doesNotMatch(source, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.doesNotMatch(source, /node eng\/ecp-gate\.mjs|git (?:checkout|switch).*TSFG_HEAD_SHA/);
  assert.doesNotMatch(source, /\$\{\{\s*secrets\.|contents:\s*write|persist-credentials:\s*true/);
});

test("ECP governance pins actions, validates untrusted event values, and retains its report", async () => {
  const source = await readFile(workflowPath, "utf8");
  for (const match of source.matchAll(/^\s+(?:-\s+)?uses:\s*([^\s#]+).*$/gm)) {
    assert.match(match[1], /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?@[0-9a-f]{40}$/);
  }
  assert.match(source, /\[\[ "\$TSFG_BASE_SHA" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.match(source, /\[\[ "\$TSFG_HEAD_SHA" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.match(source, /\[\[ "\$TSFG_PR_NUMBER" =~ \^\[1-9\]\[0-9\]\*\$ \]\]/);
  assert.match(source, /name: ecp-governance-\$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(source, /retention-days: 90/);
});
