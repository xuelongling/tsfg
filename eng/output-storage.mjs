// SPDX-License-Identifier: MIT
import {lstat,realpath} from 'node:fs/promises';
import path from 'node:path';

/** Check the nearest existing output ancestor before creating an owned stage.
 * Builders retain their own diagnostic identity through the failure factory.
 * Filesystem errors other than an absent ancestor retain their original cause.
 * @param {string} directory
 * @param {(reason:'invalid'|'missing')=>Error} failure
 */
export async function requireOrdinaryEAncestor(directory,failure) {
  for(let current=directory;;current=path.dirname(current)) {
    const state=await lstat(current).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(state) {
      if(!state.isDirectory()||state.isSymbolicLink())throw failure('invalid');
      const actual=await realpath(current);
      if(!/^E:[\\/]/i.test(actual)||path.relative(current,actual)!=='')
        throw failure('invalid');
      return;
    }
    if(path.dirname(current)===current)throw failure('missing');
  }
}
