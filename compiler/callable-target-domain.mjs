// SPDX-License-Identifier: MIT
// Code-target bounds only. A target ID never proves a closure environment or
// creates an actual callable value. Both module and complete-Program flow use
// this algebra with their own identities, diagnostics and work accounts.
export function callableTargetDomain(owned,spend,fail,compare) {
  const bottom=()=>({top:false,ids:new Set()}),top=()=>({top:true,ids:new Set()});
  const copy=value=>{spend(value.ids.size);return {top:value.top,ids:new Set(value.ids)};};
  const single=id=>{spend();if(!owned.has(id))fail('identity');return {top:false,ids:new Set([id])};};
  const join=(left,right)=>{
    spend(right.ids.size+1);const result=copy(left);result.top ||= right.top;
    for(const id of right.ids){if(!owned.has(id))fail('identity');result.ids.add(id);}return result;
  };
  const equal=(left,right)=>{spend(left.ids.size+1);return left.top===right.top&&left.ids.size===right.ids.size&&[...left.ids].every(id=>right.ids.has(id));};
  const from=value=>{spend(value.functions.length);const result={top:value.top,ids:new Set()};
    for(const id of value.functions){if(!owned.has(id))fail('identity');result.ids.add(id);}return result;};
  const wire=value=>{spend(value.ids.size);const functions=[...value.ids];functions.sort((a,b)=>{spend();return compare(a,b);});return {top:value.top,functions};};
  return {bottom,top,copy,single,join,equal,from,wire,closed:value=>!value.top&&value.ids.size>0};
}
// Supplied transfer always wins over the current body's return observation.
// Checking observations against parameter uppers remains the caller's job so
// that it can retain the original call-site diagnostic and contract identity.
export function fixedCallableTransfer(contract,args,domain,observe,spend,fail) {
  for(const row of contract.parameters){spend();const value=args[row.index];if(!value)fail('identity');observe(row.index,value);}
  return contract.returns===null?null:domain.from(contract.returns);
}
