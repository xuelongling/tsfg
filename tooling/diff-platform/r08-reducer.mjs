// SPDX-License-Identifier: MIT
// R08 Automatic Minimal-Reproducer Delta Reducer & Record/Replay Regression Serializer.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canonical, sha256 } from '../../compiler/r04-identity.mjs';
import { verifyTsfgDialect } from '../../compiler/r07-tsfg-dialect.mjs';

/**
 * Automatically reduce a failing `tsfg` dialect program to a 1-minimal reproducer:
 *   Phase 1: Eliminate non-essential operations while keeping SSA validity & preserving `isFailing(candidate)`.
 *   Phase 2: Try returning an earlier SSA register and trimming trailing ops.
 *   Phase 3: Shrink integer constants toward 0 / 1 / -1 while preserving `isFailing(candidate)`.
 */
export async function reduceFailingProgram(inputMod, isFailing) {
  if (!(await isFailing(inputMod))) {
    throw new Error('r08-reducer: input program does not reproduce failure');
  }
  let best = structuredClone(inputMod);
  let steps = 0;

  const tryCandidate = async (cand) => {
    steps++;
    try {
      verifyTsfgDialect(cand);
    } catch {
      return false;
    }
    if (await isFailing(cand)) {
      best = cand;
      return true;
    }
    return false;
  };

  // Phase 1: Try switching tsfg.return to earlier values + dropping dead ops
  let improved = true;
  while (improved) {
    improved = false;
    const fn = best.functions[0];
    const bodyOps = fn.ops;
    const retIdx = bodyOps.length - 1;
    const retOp = bodyOps[retIdx];

    // 1a. Remove any single intermediate op (indices 1..retIdx-1)
    for (let i = retIdx - 1; i >= 1; i--) {
      const cand = structuredClone(best);
      cand.functions[0].ops.splice(i, 1);
      if (await tryCandidate(cand)) {
        improved = true;
        break;
      }
    }
    if (improved) continue;

    // 1b. Replace return operand with an earlier op's result and trim ops after it
    for (let i = 1; i < retIdx; i++) {
      const op = bodyOps[i];
      if (!op.result || op.result === retOp.operands[0]) continue;
      const cand = structuredClone(best);
      cand.functions[0].ops = [...cand.functions[0].ops.slice(0, i + 1), { op: 'tsfg.return', operands: [op.result] }];
      if (await tryCandidate(cand)) {
        improved = true;
        break;
      }
    }
    if (improved) continue;

    // 1c. Shrink i32 constants toward 0 / 1 / -1
    for (let i = 1; i < retIdx; i++) {
      const op = bodyOps[i];
      if (op.op === 'tsfg.const_i32' && op.attrs.value !== 0 && op.attrs.value !== 1 && op.attrs.value !== -1) {
        for (const small of [0, 1, -1]) {
          const cand = structuredClone(best);
          cand.functions[0].ops[i].attrs.value = small;
          if (await tryCandidate(cand)) {
            improved = true;
            break;
          }
        }
        if (improved) break;
      }
    }
  }

  return {
    originalOpCount: inputMod.functions[0].ops.length,
    reduced: best,
    reducedOpCount: best.functions[0].ops.length,
    reductionSteps: steps,
  };
}

/**
 * Serialize a minimized failure or verified regression into a canonical record/replay artifact.
 */
export async function recordRegressionArtifact(outPath, { arg0, arg1, category, description, expectedOracle, program, seed }) {
  const record = {
    arg0,
    arg1,
    category,
    description,
    expectedOracle,
    family: 'tsfg.r08-regression',
    program,
    recordHash: '',
    seed,
    version: 1,
  };
  record.recordHash = sha256(canonical({ ...record, recordHash: '' }));
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${canonical(record)}\n`, 'utf8');
  return record;
}

export async function loadRegressionArtifact(filePath) {
  const raw = JSON.parse(await readFile(filePath, 'utf8'));
  const expectedHash = sha256(canonical({ ...raw, recordHash: '' }));
  if (raw.recordHash !== expectedHash) {
    throw new Error(`r08-replay-corrupted: hash mismatch in ${filePath}`);
  }
  verifyTsfgDialect(raw.program);
  return raw;
}
