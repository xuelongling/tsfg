// SPDX-License-Identifier: MIT
import {readFileSync} from 'node:fs';

// Load complete, unchanged public Go producer bytes and their original request.
export function systemQueryFixture(name){
  const bytes=readFileSync(new URL('./testdata/system-query/'+name+'-facts.json',import.meta.url));
  const requestBytes=readFileSync(new URL('./testdata/system-query/'+name+'-request.json',import.meta.url));
  const packet=JSON.parse(bytes.toString());
  return {bytes,packet,context:{family:'tsfg.system-query-context-candidate',version:5,requestBytes,expectedPackageId:packet.packageId}};
}
