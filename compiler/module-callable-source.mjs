// SPDX-License-Identifier: MIT
// Validate the complete bounded source graph; no TS resolver or target inference lives here.
import { check, same, valueType, expressionType, functionType, capability, meter } from './module-callable-common.mjs';
import { validateModuleFacts, staticBindingName, sourceTrivia } from './module-facts.mjs';
import { sourceGrammar } from './closure-source-grammar.mjs';
import { validScalarUnary, validScalarBinary } from './scalar-operators.mjs';
export function verifySource(input,facts,annotations,exports) {
  const sources=new Map(input.files.map(f=>[f.path,{path:f.path,content:f.content}]));
  const ownership=validateModuleFacts({identityInput:input,inputs:input.files,sources:[...sources.values()],symbols:facts.symbols,modules:facts.modules,hostImports:[],compilationClosure:input.compilationClosure});
  const defs=new Map(),fns=new Map(),claimed=new Set(),grammar=new Map();
  let nodes=0;
  const count=()=>check(++nodes<=16384,'limit');
  for(const [i,s]of facts.symbols.entries()){
    check(s.id==='s'+(i+1)&&!defs.has(s.id),'identity');defs.set(s.id,s);
    check(sources.has(s.sourcePath),'identity');
  }
  for(const fn of facts.functions){check(!fns.has(fn.symbol),'identity');fns.set(fn.symbol,fn);}
  function gFor(path){if(!grammar.has(path))grammar.set(path,sourceGrammar(sources.get(path)));return grammar.get(path);}
  function span(r,path,parent={start:0,end:sources.get(path).content.length}){
    const text=sources.get(path).content;
    check(r.start>=parent.start&&r.start<r.end&&r.end<=parent.end,'source');
    for(const n of [r.start,r.end])check(!(text.charCodeAt(n)>=0xdc00&&text.charCodeAt(n)<=0xdfff&&text.charCodeAt(n-1)>=0xd800&&text.charCodeAt(n-1)<=0xdbff),'source');
  }
  // The direct integer projector reuses the header's functionInfo.Signature,
  // including original scalar declaration rows. functionValueSignature instead
  // rebuilds structural callable facts, omitting presence at every nested level.
  // Preserve that path distinction rather than normalizing either representation.
  function signaturePresence(signature, expected = undefined) {
    if (!signature) return;
    if (expected === undefined) check(!Object.hasOwn(signature, 'presence'), 'source');
    else check(same(signature.presence, expected), 'source');
    for (const nested of signature.parameterSignatures ?? [])
      if (nested) signaturePresence(nested);
    if (signature.returnSignature) signaturePresence(signature.returnSignature);
  }
  const aliases = new Map(), directCalls = new Map(), aliasCallers = new Set();
  const callableGlobals = facts.symbols.filter(s => s.kind === 'global' && s.type === 'function');
  const callableInitializers = facts.modules.flatMap(m => m.initialization.filter(
    s => s.kind === 'initialize' && s.symbol.type === 'function'));
  const aliasProfile = callableGlobals.length > 0 || callableInitializers.length > 0;
  let alias, aliasInitializer, calls = 0;
  if (aliasProfile) {
    check(callableGlobals.length === 1 && callableInitializers.length === 1, 'source');
    alias = callableGlobals[0];
    aliasInitializer = callableInitializers[0];
    const module = facts.modules[0];
    const applications = input.files.filter(f => !f.path.endsWith('.d.ts'));
    check(facts.modules.length === 1 && applications.length === 1 && module.external
      && applications[0].path === module.sourcePath && module.imports.length === 0, 'source');
    check(alias.sourcePath === module.sourcePath && alias.bindingKind === 'source'
      && !alias.writable && same(aliasInitializer.symbol, alias), 'source');
    check(!module.exports.some(binding => binding.target === alias.id), 'source');
    check([...input.compilationClosure.roots, ...input.compilationClosure.requiredRoots]
      .every(root => root.sourcePath !== alias.sourcePath || root.name !== alias.name), 'source');
    const initializer = aliasInitializer.initializer;
    check(initializer.kind === 'functionReference', 'source');
    const target = fns.get(initializer.target), targetSymbol = defs.get(initializer.target);
    check(target && targetSymbol?.kind === 'function' && target.sourcePath === alias.sourcePath
      && targetSymbol.sourcePath === alias.sourcePath && target.parameters.length === 1, 'source');
    const parameter = target.parameters[0], signature = alias.signature;
    check(['bool', 'i32'].includes(parameter.type) && target.returnType === parameter.type
      && parameter.signature === undefined && target.returnSignature === undefined, 'source');
    check(signature && same(signature, initializer.signature)
      && same(signature.parameters, [parameter.type]) && signature.returnType === parameter.type
      && same(valueType('function', signature), functionType(target)), 'source');
    for (const fn of facts.functions) {
      check(fn.sourcePath === module.sourcePath && ['bool', 'i32'].includes(fn.returnType)
        && fn.returnSignature === undefined && fn.parameters.every(p => ['bool', 'i32'].includes(p.type)
          && p.signature === undefined), 'source');
    }
    for (const symbol of facts.symbols) {
      if (symbol.kind !== 'function' && symbol.id !== alias.id)
        check(['bool', 'i32'].includes(symbol.type) && symbol.signature === undefined, 'source');
    }
    const initializedGlobals = new Set();
    for (const item of module.initialization) {
      check(item.kind === 'initialize' && !initializedGlobals.has(item.symbol.id), 'source');
      initializedGlobals.add(item.symbol.id);
      const global = defs.get(item.symbol.id);
      check(global?.kind === 'global' && same(global, item.symbol), 'source');
      if (global.id !== alias.id) {
        const kind = global.type === 'bool' ? 'boolean' : 'integer';
        check(item.initializer.kind === kind && item.initializer.type === global.type, 'source');
      }
    }
    check(facts.symbols.filter(s => s.kind === 'global')
      .every(global => initializedGlobals.has(global.id)), 'source');
    // The map is internal proof data only. The original snapshot keeps both Symbols.
    aliases.set(alias.id, initializer.target);
  }
  const embedded=s=>{check(same(defs.get(s.id),s),'identity');claimed.add(s.id);};
  const equivalent=(a,b)=>{if(typeof a==='object'&&typeof b==='object')return;check(same(a,b),'source');};
  for(const s of facts.symbols){
    span(s.range,s.sourcePath);gFor(s.sourcePath).name(s.range,s.name);
    if (s.signature) signaturePresence(s.signature);
    if(s.kind==='global'){check(s.type!=='function'||aliases.has(s.id),'source');claimed.add(s.id);}
  }
  function body(fn,items,parent,inherited,initialized,module=false){
    const path=fn.sourcePath,g=gFor(path),visible=new Map(inherited),here=new Set();
    for(const item of items)if(item.kind==='variable'){
      embedded(item.symbol);check(!here.has(item.symbol.name),'source');here.add(item.symbol.name);visible.set(item.symbol.name,item.symbol.id);
    }
    let previous=parent.start,returned=false;
    function ex(v,outer,write=false,role=undefined){
      count();span(v.range,path,{start:Math.min(v.range.start,outer.start),end:outer.end});
      if(v.range.start<outer.start)g.expect(v.range.start,outer.start,[]);
      const type=expressionType(v);
      if (v.signature && !['call','indirectCall'].includes(v.kind)) signaturePresence(v.signature);
      if(write)check(v.kind==='reference'||v.kind==='group','source');
      if(v.kind==='reference'||v.kind==='functionReference'){
        const id=v.kind==='reference'?v.symbol:v.target,d=defs.get(id);
        check(d&&ownership.views.get(path),'identity');
        const name=staticBindingName(v.name),base=name.split('.')[0];
        check((visible.get(name)??ownership.views.get(path).get(name))===id&&!(!visible.has(name)&&name.includes('.')&&visible.has(base)),'source');
        check(staticBindingName(sources.get(path).content.slice(v.range.start,v.range.end))===name,'source');
        if(v.kind==='functionReference')check(d.kind==='function'&&same(type,functionType(fns.get(id))),'source');
        else {check(d.kind!=='function'&&same(type,valueType(d.type,d.signature)),'source');if(d.kind==='local')check(initialized.has(id),'source');}
        if (aliasProfile) {
          if (v.kind === 'functionReference') {
            check(role === 'alias-initializer' && v.target === aliases.get(alias.id), 'source');
          } else if (v.symbol === alias.id) {
            check(role === 'alias-callee' && !write && same(v.signature, alias.signature), 'source');
          } else check(v.type !== 'function', 'source');
        }
        if(write)check(d.writable&&v.kind==='reference','source');
      }else if(v.kind==='call'||v.kind==='indirectCall'){
        if (aliasProfile) {
          check(!module && fn.symbol, 'source');
          check(++calls <= 16384, 'limit');
        }
        const sig=valueType('function',v.signature);let end;
        if(v.kind==='call'){
          const target=fns.get(v.target);check(target&&same(sig,functionType(target)),'source');
          if (aliasProfile) {
            if (!directCalls.has(fn.symbol)) directCalls.set(fn.symbol, []);
            directCalls.get(fn.symbol).push(v.target);
          }
          const scalarPath = target.returnType !== 'function'
            && target.parameters.every(parameter => parameter.type !== 'function');
          signaturePresence(v.signature, scalarPath && target.parameters.length
            ? target.parameters.map(parameter => parameter.presence) : undefined);
          check((visible.get(v.name)??ownership.views.get(path).get(v.name))===v.target&&!visible.has(v.name),'source');
          const ts=g.between(v.range.start,v.range.end),open=ts.findIndex(t=>t.text==='(');check(open>0,'source');
          check(staticBindingName(sources.get(path).content.slice(ts[0].start,ts[open].start))===staticBindingName(v.name),'source');end=ts[open].start;
        }else {
          if (aliasProfile) {
            check(v.callee.kind === 'reference' && v.callee.symbol === alias.id
              && same(v.signature, alias.signature), 'source');
            aliasCallers.add(fn.symbol);
          }
          signaturePresence(v.signature);
          ex(v.callee,v.range,false,aliasProfile ? 'alias-callee' : undefined);
          check(same(expressionType(v.callee),sig),'source');
          // The producer names the original callee AST, not its projected name:
          // identity(fn)() has callee spelling identity(fn), not identity.
          const first=g.between(v.callee.range.start,v.callee.range.end)[0];
          check(first&&v.name===sources.get(path).content.slice(first.start,v.callee.range.end),'source');
          end=v.callee.range.end;
        }
        check(v.arguments.length===sig.parameters.length&&same(type,sig.returns),'source');
        for(const [i,arg]of v.arguments.entries()){g.expect(end,arg.range.start,[i?',':'(']);ex(arg,v.range);equivalent(expressionType(arg),sig.parameters[i]);end=arg.range.end;}
        const tail=g.spelling(end,v.range.end);check(same(tail,v.arguments.length?[')']:['(',')'])||v.arguments.length>0&&same(tail,[',',')']),'source');
      }else if(v.kind==='boolean'){check(type==='bool','source');g.expect(v.range.start,v.range.end,[String(v.boolean)]);}
      else if(v.kind==='integer'){
        let n;try{n=BigInt(v.literal.token.replaceAll('_',''));}catch{check(false,'source');}
        check(type==='i32'&&n>=-2147483648n&&n<=2147483647n&&String(n)===v.literal.decimal,'source');
        check(g.spelling(v.range.start,v.range.end).join('')===v.literal.token,'source');
      }else if(v.kind==='group'||v.kind==='unary'){
        ex(v.operand,v.range,write);if(v.kind==='group')check(same(type,expressionType(v.operand)),'source');
        else check(validScalarUnary(v.operator,type,expressionType(v.operand),v.operand.kind),'source');
        g.expect(v.range.start,v.operand.range.start,[v.kind==='group'?'(':v.operator]);g.expect(v.operand.range.end,v.range.end,v.kind==='group'?[')']:[]);
      }else if(v.kind==='binary'||v.kind==='shortCircuit'){
        ex(v.left,v.range);ex(v.right,v.range);check(validScalarBinary(v.kind,v.operator,type,expressionType(v.left),expressionType(v.right),v.left,v.right),'source');
        g.expect(v.range.start,v.left.range.start,[]);g.expect(v.left.range.end,v.right.range.start,[v.operator]);g.expect(v.right.range.end,v.range.end,[]);
      }else {
        if (aliasProfile) check(false, 'source');
        capability();
      }
      return type;
    }
    for(const item of items){
      count();span(item.range,path,parent);check(item.range.start>=previous,'source');
      const gap=g.spelling(previous,item.range.start).filter(x=>x!==';');
      if(item.kind==='variable'||item.kind==='initialize'){
        embedded(item.symbol);const d=item.symbol;
        check(gap.length===1&&['let','const'].includes(gap[0])||module&&same(gap,['export','let'])||module&&same(gap,['export','const']),'source');
        check(d.writable===gap.includes('let')&&same(d.range,{start:item.range.start,end:d.range.end}),'source');
        const aliasInitialization = aliasProfile && d.id === alias.id;
        if (aliasInitialization) {
          check(module && item === aliasInitializer && same(gap, ['const']), 'source');
          g.expect(d.range.end,item.initializer.range.start,['=']);
        }
        equivalent(ex(item.initializer,item.range,false,
          aliasInitialization ? 'alias-initializer' : undefined),valueType(d.type,d.signature));
        const middle=g.between(d.range.end,item.initializer.range.start);
        if(middle[0]?.text===':'){check(middle.at(-1).text==='=','source');g.annotation(middle[0].end,middle.at(-1).start,valueType(d.type,d.signature));}
        else g.expect(d.range.end,item.initializer.range.start,['=']);
        g.expect(item.initializer.range.end,item.range.end,[]);initialized.add(d.id);
      }else{
        check(gap.length===0,'source');
        if(item.kind==='return'||item.kind==='expression'){
          const t=ex(item.expression,item.range);g.expect(item.range.start,item.expression.range.start,item.kind==='return'?['return']:[]);
          check(g.spelling(item.expression.range.end,item.range.end).every(x=>x===';'),'source');
          if(item.kind==='return'){check(!module,'source');equivalent(t,valueType(fn.returnType,fn.returnSignature));returned=true;}
        }else if(item.kind==='assignment'){
          ex(item.target,item.range,true);equivalent(ex(item.value,item.range),expressionType(item.target));g.expect(item.range.start,item.target.range.start,[]);g.expect(item.target.range.end,item.value.range.start,['=']);check(g.spelling(item.value.range.end,item.range.end).every(x=>x===';'),'source');
        }else if(item.kind==='block'){
          const ts=g.between(item.range.start,item.range.end);check(ts[0]?.text==='{'&&ts.at(-1)?.text==='}','source');
          returned=body(fn,item.body??[],{start:ts[0].end,end:ts.at(-1).start},visible,new Set(initialized),module)||returned;
        }else if(item.kind==='if'||item.kind==='while'){
          check(ex(item.condition,item.range)==='bool','source');g.expect(item.range.start,item.condition.range.start,[item.kind,'(']);
          const left=item.kind==='if'?(item.thenBody??[]):(item.body??[]),right=item.elseBody??[];check(left.length===1,'source');g.expect(item.condition.range.end,left[0].range.start,[')']);
          const l=body(fn,left,{start:left[0].range.start,end:left.at(-1).range.end},visible,new Set(initialized),module);let end=left.at(-1).range.end;
          if(right.length){check(right.length===1,'source');g.expect(end,right[0].range.start,['else']);const r=body(fn,right,{start:right[0].range.start,end:right.at(-1).range.end},visible,new Set(initialized),module);returned=returned||l&&r;end=right.at(-1).range.end;}
          g.expect(end,item.range.end,[]);
        }else {
          if (aliasProfile) check(false, 'source');
          capability();
        }
      }
      previous=item.range.end;
    }
    check(g.spelling(previous,parent.end).every(x=>x===';'),'source');return returned;
  }
  check(annotations.length===facts.functions.length,'identity');
  for(const [i,fn]of facts.functions.entries()){
    const d=defs.get(fn.symbol),a=annotations[i],g=gFor(fn.sourcePath);check(d?.kind==='function'&&d.sourcePath===fn.sourcePath&&d.name===fn.name&&d.type===fn.returnType,'identity');claimed.add(d.id);
    check(a.symbol===fn.symbol&&a.sourcePath===fn.sourcePath&&same(a.declarationRange,fn.range)&&same(a.nameRange,d.range),'source');
    if (fn.returnSignature) signaturePresence(fn.returnSignature);
    const header=g.header(fn),headerTokens=g.between(fn.range.start,header.start);
    const open=headerTokens.findIndex(t=>t.text==='(');let level=0,close=-1;
    for(let k=open;k<headerTokens.length;k++){
      if(headerTokens[k].text==='(')level++;
      if(headerTokens[k].text===')'&&--level===0){close=k;break;}
    }
    check(close>=0&&headerTokens[close+1]?.text===':'&&headerTokens.at(-1)?.text==='{','source');
    const returnStart=headerTokens[close+2],returnEnd=headerTokens.at(-2);
    check(same(a.returnAnnotationRange,{start:returnStart?.start,end:returnEnd?.end}),'source');
    g.annotation(a.returnAnnotationRange.start,a.returnAnnotationRange.end,valueType(fn.returnType,fn.returnSignature));
    check(a.parameters.length===fn.parameters.length,'source');const visible=new Map(),initialized=new Set();
    for(const [j,p]of fn.parameters.entries()){
      embedded(p);check(p.kind==='parameter'&&p.sourcePath===fn.sourcePath&&!visible.has(p.name),'source');visible.set(p.name,p.id);initialized.add(p.id);
      const pa=a.parameters[j];
      check(pa.symbol===p.id&&same(pa.nameRange,p.range)&&pa.declarationRange.start===p.range.start&&pa.declarationRange.end===pa.annotationRange.end,'source');
      const nameIndex=headerTokens.findIndex(t=>t.end===p.range.end&&t.start>=p.range.start);
      check(nameIndex>=0&&headerTokens[nameIndex+1]?.text===':','source');
      let endIndex=nameIndex+2,nesting=0;
      for(;endIndex<close;endIndex++){
        const token=headerTokens[endIndex].text;
        if(token===','&&nesting===0)break;
        if(token==='(')nesting++;
        if(token===')')nesting--;
      }
      check(same(pa.annotationRange,{start:headerTokens[nameIndex+2]?.start,end:headerTokens[endIndex-1]?.end}),'source');
      g.annotation(pa.annotationRange.start,pa.annotationRange.end,valueType(p.type,p.signature));
      if (p.type !== 'function') {
        check(same(p.presence, {
          undefined:false, null:false, optional:false, default:false,
          range:pa.declarationRange, annotation:pa.annotationRange,
        }), 'source');
      }
    }
    check(body(fn,fn.body,header,visible,initialized),'source');
  }
  // Whole top-level coverage includes imports, reexports and initializer declarations.
  for(const module of facts.modules){
    const g=gFor(module.sourcePath),events=[...facts.functions.filter(f=>f.sourcePath===module.sourcePath).map(f=>({range:f.range,kind:'function'})),...module.imports.map(e=>({range:e.range,kind:'edge'})),...module.initialization.map(s=>({range:s.range,kind:'initialization',statement:s}))].sort((a,b)=>a.range.start-b.range.start);
    let end=0;
    for(const e of events){
      check(e.range.start>=end,'source');const gap=g.spelling(end,e.range.start).filter(x=>x!==';');
      if(e.kind==='initialization'){
        const item=e.statement,fn={sourcePath:module.sourcePath};const prefix=item.kind==='initialize'?gap:[];
        check(item.kind==='initialize'||gap.length===0,'source');
        const start=prefix.length?g.between(end,e.range.start)[0].start:e.range.start;
        body(fn,[item],{start,end:e.range.end},new Map(),new Set(),true);
      }else check(gap.length===0,'source');end=e.range.end;
    }
    check(g.spelling(end,sources.get(module.sourcePath).content.length).every(x=>x===';'),'source');
  }
  check(exports.length===facts.modules.length,'identity');
  for(const [i,group]of exports.entries()){
    const module=facts.modules[i];check(group.sourcePath===module.sourcePath&&group.external===module.external,'identity');
    check(same(group.bindings.map(b=>({name:b.name,target:b.target})),module.exports.map(b=>({name:b.name,target:b.target}))),'identity');
    for(const [bindingIndex,b]of group.bindings.entries()){
      const rawExport=module.exports[bindingIndex];
      const d=defs.get(b.target),fn=fns.get(b.target),init=facts.modules.flatMap(m=>m.initialization).find(s=>s.kind==='initialize'&&s.symbol.id===b.target);
      check(d&&b.originSourcePath===d.sourcePath&&same(b.nameRange,d.range)&&same(b.definitionRange,fn?.range??init?.range),'source');span(b.range,group.sourcePath);
      const text=sourceTrivia(sources.get(group.sourcePath).content,b.range.start,b.range.end).trim();
      if(b.originSourcePath===group.sourcePath&&b.name===d.name&&fn){
        check(text.startsWith('export')&&same(b.range,{start:gFor(group.sourcePath).between(fn.range.start,fn.range.end)[0].start,end:fn.range.end}),'source');
        check(same(rawExport.range,fn.range),'source');
      }else if(b.originSourcePath===group.sourcePath&&init&&b.name===d.name){
        check(b.range.end===init.range.end&&b.range.start>=init.range.start,'source');
        check(same(rawExport.range,init.range),'source');
      }
      else {
        const edge=module.imports.find(e=>e.kind==='export'&&b.range.start>=e.range.start&&b.range.end<=e.range.end);
        const names=text.split(/\s+as\s+/);const imported=names[0];
        check(edge&&facts.modules.find(m=>m.sourcePath===edge.sourcePath)?.exports.some(x=>x.target===b.target&&(text.startsWith('export')||x.name===imported)),'source');
        if (/^export\s*\*\s*from\b/.test(text)) {
          // Multiple stars can expose the same original declaration. Custody
          // belongs to the first resolving source edge, not any equivalent edge.
          const first = module.imports.find(candidate => {
            if (candidate.kind !== 'export') return false;
            const spelling = sourceTrivia(sources.get(group.sourcePath).content,
              candidate.range.start, candidate.range.end).trim();
            if (!/^export\s*\*\s*from\b/.test(spelling)) return false;
            return facts.modules.find(m => m.sourcePath === candidate.sourcePath)
              ?.exports.some(binding => binding.name === b.name && binding.target === b.target);
          });
          check(first, 'source');
          const start = gFor(group.sourcePath).between(first.range.start, first.range.end)[0]?.start;
          check(same(b.range, {start, end:first.range.end}), 'source');
          // A star retains no declaration in the exporting file, so the legacy
          // raw table uses its full SourceFile range, unlike enriched custody.
          check(same(rawExport.range,{start:0,end:sources.get(group.sourcePath).content.length}),'source');
        }else {
          check(!text.startsWith('export')&&(names[1]??names[0])===b.name,'source');
          const tokens=gFor(group.sourcePath).between(edge.range.start,edge.range.end);
          const first=tokens.findIndex(token=>token.start===b.range.start);
          const last=tokens.findIndex(token=>token.end===b.range.end);
          // ExportSpecifier.Pos begins after its preceding brace/comma, before
          // trivia; enriched expressionOffset begins at the first name token.
          check(first>0&&last>=first&&['{',','].includes(tokens[first-1].text)
            &&[',','}'].includes(tokens[last+1]?.text),'source');
          check(last===first||last===first+2&&tokens[first+1].text==='as','source');
          check(same(rawExport.range,{start:tokens[first-1].end,end:tokens[last].end}),'source');
        }
      }
    }
  }
  check(facts.symbols.every(s=>claimed.has(s.id)),'identity');
  if (aliasProfile) {
    // Ordinary direct SCCs remain valid; reaching an alias call closes an alias cycle.
    const pending = [aliases.get(alias.id)], visited = new Set();
    while (pending.length) {
      const target = pending.pop();
      if (visited.has(target)) continue;
      visited.add(target);
      check(visited.size <= 128, 'limit');
      check(!aliasCallers.has(target), 'source');
      pending.push(...(directCalls.get(target) ?? []));
    }
  }
  return {ownership,defs,fns,sources,aliases};
}
