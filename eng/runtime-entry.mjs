// SPDX-License-Identifier: MIT
import {readFile} from 'node:fs/promises';
import path from 'node:path';

// The synchronous Runtime seam is a separate link obligation from Counter.
// Counter-only ordinary AOT consumers never need a VM body or a replacement.
export async function prepareRuntimeEntry({product,stage,tools,environment,run}) {
  const source=path.join(product,'runtime/admitted-entry.c');
  const object=path.join(stage,'admitted-entry.obj'),before=await readFile(source);
  const args=['/nologo','/c','/O2','/GS-','/Zl','/Brepro','/clang:-fno-ident',source,'/Fo'+object];
  const result=await run({executable:tools.clangcl,args,cwd:product,environment,label:'runtime-entry'});
  if(result.code!==0 || result.signal || !before.equals(await readFile(source)))
    throw new TypeError('vm-runtime-entry: source build failed or source changed');
  if((await readFile(object)).length===0)throw new TypeError('vm-runtime-entry: empty object');
  return object;
}
