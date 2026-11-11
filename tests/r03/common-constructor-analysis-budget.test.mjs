// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createCommonProgramPublication } from '../../compiler/common-program-analysis.mjs';
import { commonProgramCore } from '../../compiler/common-program-core.mjs';
import { readCommonProgramFacts } from '../../compiler/common-program-facts.mjs';
import { projectCommonProgram } from '../../compiler/common-program-hir.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const report = process.env.TSFG_CONSTRUCTOR_ANALYSIS_REPORT;

test('the complete official class and method program fits the fixed verifier budget',
  { skip: report ? false : 'TSFG_CONSTRUCTOR_ANALYSIS_REPORT is not supplied' }, async () => {
    assert.ok(report && path.isAbsolute(report));
    const json = async name => JSON.parse(await fs.readFile(path.join(report, name), 'utf8'));
    const facts = readCommonProgramFacts(await fs.readFile(new URL('./common-program-method-dispatch.json', import.meta.url)));
    assert.equal(facts.packageId, 'sha256:fa62521083c39097559bcc17a6a44689b00300d268912de5cafa31af0f3703b4');
    const hir = projectCommonProgram(facts);
    const source = hir.sources.find(row => row.path === '/src/main.ts');
    assert.ok(source);
    assert.equal(sha(source.content), 'b6e5f5f7a8d3e2b414cb8a0504e21f82401bf702aae2abc82a7da98404a45c0c');
    assert.equal(hir.functions.length, 17);
    const ordered = hir.functions.find(row => row.name === 'ordered');
    assert.ok(ordered);
    assert.equal(ordered.id, 'sha256:3dda35d249f901d6add7bd9f5b035b5f7a314d4b31086f9fb99bfe0a58bdd14e');
    assert.deepEqual(ordered.range, { start: 1654, end: 1729 });
    const publication = createCommonProgramPublication(hir);
    const { text } = commonProgramCore(hir, publication, {
      targets: hir.closure.requiredRoots.filter(row => row.kind === 'kernel').map(row => row.target).sort(),
    });
    const config = await json('config.json');
    assert.equal(config.args.length, 1);
    const actualCore = await fs.readFile(config.args[0]);
    assert.equal(sha(actualCore), sha(text));
    const observed = await json('observed.json');
    assert.equal(observed.qualified, true);
    assert.deepEqual(observed.first, []);
    assert.deepEqual([observed.exit.code, observed.close.code], [0, 0]);
    const [stdout, stderr] = await Promise.all(['stdout', 'stderr']
      .map(stream => fs.readFile(path.join(report, 'raw', stream + '.bin'))));
    assert.equal(sha(stdout), observed.stdout.confirmedWriteSHA256);
    assert.equal(sha(stderr), observed.stderr.confirmedWriteSHA256);
    assert.equal(stderr.length, 0);
    const result = JSON.parse(stdout.toString('utf8'));
    assert.equal(result.completeCoreVerified, true);
    assert.equal(result.inputIdentity, hir.inputIdentity);
    assert.equal(result.functions, hir.functions.length + hir.modules.length);
    assert.ok(result.remainingWork > 0 && result.remainingWork < 4_000_000);
    assert.equal(result.executionAuthority, false);
  });
