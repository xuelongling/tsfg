// SPDX-License-Identifier: MIT
// Current-run candidates are immutable: identical reruns reuse, changes fail.
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
export async function writeTypedArrayCandidate(path,value) {
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(value);
  try {await writeFile(path,bytes,{flag:'wx'});}
  catch(error) {
    if(error.code!=='EEXIST')throw error;
    assert.deepEqual(await readFile(path),bytes,'candidate path already has different immutable bytes: '+path);
  }
}
