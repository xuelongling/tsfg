// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,buildInitialArrayPublication,verifyHir,printHir,readHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {finiteNormalFlow,finiteNormalLogical} from '../../compiler/finite-numeric-use.mjs';
import {canonical,sha256,i32TypeId,boolTypeId} from '../../compiler/identity.mjs';
import {originId} from '../../compiler/typed-array-schema.mjs';
import {staticPublication} from './typed-array-publication-fixtures.mjs';

// Official Source private-v8 packet: preserve pure assertions, initialized
// undefined, conditional numeric use and the original operation ranges.
const bytes=await readFile(new URL('./testdata/typed-array-holder-parameter/valid-undefined-numeric-package.json',import.meta.url));
assert.equal(bytes.length,21597);
assert.equal(sha256(bytes),'sha256:5215e5bdcac3dedf45450606499f60ea838a9cd3d6ae1b64f5737165cce5cdfc');
const facts=readTypedArrayFacts(bytes),source=facts.payload.files.find(file=>file.path===facts.payload.rootFile);
assert.equal(sha256(source.content),'sha256:fa359e55b9a6c435329f6ff155ea6a36f8d3771c1569cbce22d355f4be1e36c9');
const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
const none={read:false,write:false,structural:false};
const publication=staticPublication(facts,{keep:{parameters:{0:{...none,read:true}},local:none}});
const built=buildHir(facts,context,publication);
assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
const hir=built.hir;

function derivedPacketBytes(packet) {
  const payload=packet.payload,{sourceRoot,rootFile,declarations,config}=payload;
  const request={family:'tsfg.array-facts-request-candidate',version:8,input:{sourceRoot,rootFile,declarations,config,
    files:payload.files.map(({path,content,sha256})=>({path,content,sha256}))}};
  packet.requestId=sha256('tsfg.array-facts.request.v8\0'+canonical(request)+'\n');
  packet.packageId=sha256('tsfg.array-facts.package.v8\0'+packet.schemaHash+'\0'+canonical(payload));
  return Buffer.from(canonical(packet)+'\n');
}

test('owned finite facts reject a nonnumeric local nullish assignment target',async()=>{
  const raw=await readFile(new URL('./testdata/typed-array-span-storage/3157dd0efbe9ead0858a3dda6019984267784ea258f9409875819f10719dd16d-package.json',import.meta.url));
  assert.equal(sha256(raw),'sha256:cd29101ad0f62a526e83977c5a66bed520a9f7c7df2c6e4ffd9067b9897db1e9');
  const packet=structuredClone(readTypedArrayFacts(raw)),payload=packet.payload;
  const fn=payload.functions.find(row=>row.name==='readAfterBranch'),assignment=fn.body[3].then[0].value;
  const file=payload.files.find(row=>row.path===fn.sourcePath),start=assignment.target.range.end,end=assignment.value.range.start;
  assert.equal(file.content.slice(start,end),' = ');
  file.content=file.content.slice(0,start)+'??='+file.content.slice(end);
  file.sha256=sha256(file.content).slice(7);
  assignment.operator='??=';assignment.operatorRange={start,end};
  assert.throws(()=>readTypedArrayFacts(derivedPacketBytes(packet)),error=>{
    assert.ok(error instanceof Error&&'code' in error&&'primary' in error);
    assert.equal(error.code,'r03-typed-array-type');
    assert.deepEqual(error.primary,{sourceId:fn.sourcePath,...assignment.range});
    return true;
  });
});

test('finite local nullish assignment writes and joins RHS locals only on actual absence',()=>{
  const packet=structuredClone(facts),payload=packet.payload,keep=payload.functions.find(fn=>fn.name==='keep');
  const [x,y]=keep.bindings,[local,previous,returned]=keep.body;
  const file=payload.files.find(row=>row.path===keep.sourcePath);
  const keyword=x.nameRange.start-'const '.length,start=y.nameRange.start-'const '.length,end=returned.range.end;
  // Derive the writable and side-effecting shapes within the retained Source
  // width. Original call sites still supply both i32 and actual undefined.
  const replacement='let y:i32=0;return (x??=(y=1))+y;';
  assert.equal(file.content.slice(keyword,keyword+5),'const');
  assert.ok(replacement.length<=end-start);
  file.content=file.content.slice(0,keyword)+'let  '+file.content.slice(keyword+5,start)+
    replacement.padEnd(end-start)+file.content.slice(end);
  file.sha256=sha256(file.content).slice(7);
  const span=(from,to)=>({start:start+from,end:start+to});
  const typed=(kind,from,to)=>({kind,type:'i32',flowType:'i32',range:span(from,to)});
  const literal=(digit,offset)=>({...typed('numericLiteral',offset,offset+1),token:digit,decimal:digit});
  const assign=(binding,operator,from,value,to)=>({...typed('bindingAssignment',from,to),operator,
    operatorRange:span(from+1,from+1+operator.length),
    target:{kind:'bindingTarget',type:'i32',binding,range:span(from,from+1)},value});
  x.writable=true;local.kind='letDeclaration';
  Object.assign(y,{name:'y',nameRange:span(4,5),annotationRange:span(6,9),declarationRange:span(4,11),writable:true});
  y.id=originId(keep.sourcePath,y.nameRange);
  Object.assign(previous,{kind:'letDeclaration',binding:y.id,range:span(4,12),initializer:literal('0',10)});
  const inner=assign(y.id,'=',25,literal('1',27),28);
  const coalesce=assign(x.id,'??=',20,{...typed('parentheses',24,29),expression:inner},29);
  returned.range=span(12,33);
  returned.value={...typed('binary',19,32),operator:'+',operatorRange:span(30,31),
    left:{...typed('parentheses',19,30),expression:coalesce},
    right:{...typed('bindingReference',31,32),binding:y.id}};

  const factsBytes=derivedPacketBytes(packet),derived=readTypedArrayFacts(factsBytes);
  const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes,expectedPackageId:derived.packageId};
  const publication=buildInitialArrayPublication(context),built=buildHir(derived,context,publication);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const owner=built.hir.functions.find(fn=>fn.name==='keep');
  const plan=buildFiniteCoreDomains(built.hir,context,{publicationContext:publication}).reached;
  const actual=path=>plan.domains.find(domain=>domain.id===plan.nodes.find(node=>node.id===owner.id+path).domainId).actualTypes;
  assert.deepEqual(actual('/body/0/initializer'),[sha256('tsfg.type\0undefined'),i32TypeId].sort());
  assert.deepEqual(actual('/return'),[i32TypeId]);
  const core=lowerFormalHir(built.hir,context,publication),entry=core.indexOf('func.func @"f'+owner.id.slice(7)+'"');
  assert.ok(entry>=0);
  const body=core.slice(entry).split('\n  }')[0],lines=body.split('\n');
  const comparisons=lines.filter(line=>line.includes('"tsfg_core.domain.presence_equal"'));
  assert.equal(comparisons.length,1);
  assert.match(comparisons[0],/operator = "!=="/u);
  const zero=lines.find(line=>line.includes('"tsfg_core.constant"() {value = 0 : i32'));
  const rhs=lines.filter(line=>line.includes('"tsfg_core.constant"() {value = 1 : i32'));
  assert.ok(zero);assert.equal(rhs.length,1);
  const conditional=lines.find(line=>line.includes('cf.cond_br'));
  const [,yes,no]=conditional?.match(/\^(bb\d+), \^(bb\d+)/u)??[];
  assert.ok(yes&&no);
  const noStart=lines.findIndex(line=>line.trimStart().startsWith('^'+no+':'));
  assert.ok(lines.indexOf(rhs[0])>noStart);
  const join=lines.find(line=>line.startsWith('  ^')&&[...line.matchAll(/%v\d+: /gu)].length===3);
  assert.ok(join);
  const name=join.trim().split('(')[0],edges=lines.filter(line=>line.includes('cf.br '+name+'('));
  const id=line=>line.trim().split(' = ')[0];
  assert.equal(edges.length,2);
  assert.ok(edges.some(line=>line.includes(', '+id(zero)+' :')));
  assert.ok(edges.some(line=>line.includes(', '+id(rhs[0])+' :')));
  const [expression,,updatedY]=[...join.matchAll(/(%v\d+): /gu)].map(match=>match[1]);
  const added=lines.find(line=>line.includes('"tsfg_core.add"'));
  assert.ok(added?.includes(', '+updatedY+')'));
  assert.ok(lines.some(line=>line.includes('"tsfg_core.domain.view"('+expression+')')));
});

function localInitializedUndefined(file,binding,declaration) {
  const init=declaration.initializer,from=init.range.start;
  assert.equal(file.content.slice(from,init.range.end),'keep(a,0)');
  file.content=file.content.slice(0,from)+'a[0]!'.padEnd(init.range.end-from)+file.content.slice(init.range.end);
  const span=(left,right)=>({start:from+left,end:from+right}),[array,index]=init.arguments;
  declaration.initializer={kind:'nonNull',type:'i32',flowType:'i32',range:span(0,5),operatorRange:span(4,5),
    expression:{kind:'checkedElementAccess',type:'union<i32,undefined>',flowType:'union<i32,undefined>',range:span(0,4),
      receiver:{...array,range:span(0,1)},index:{...index,range:span(2,3)}}};
  declaration.range.end=from+5;binding.declarationRange.end=from+5;
}

test('finite local numeric compound captures the old value before its RHS',()=>{
  for(const mode of ['mixed','undefined','self']){
    const packet=structuredClone(facts),payload=packet.payload,entry=payload.functions.find(row=>row.name==='binary');
    const binding=entry.bindings.find(row=>row.name==='x'),[,declaration,branch,otherwise]=entry.body,returned=branch.then[0];
    const file=payload.files.find(row=>row.path===entry.sourcePath),original=returned.value,start=original.range.start;
    const keyword=binding.nameRange.start-'const '.length;
    assert.equal(file.content.slice(keyword,keyword+5),'const');
    assert.equal(file.content.slice(start,returned.range.end),'x+1;');
    const self=mode==='self',end=self?otherwise.range.end:returned.range.end,replacement=self?'x+=(x=1)}return 7':'x+=1';
    assert.equal(replacement.length,end-start);
    file.content=file.content.slice(0,keyword)+'let  '+file.content.slice(keyword+5,start)+replacement+file.content.slice(end);
    const at=(from,to)=>({start:start+from,end:start+to});
    const typed=(kind,from,to)=>({kind,type:'i32',flowType:'i32',range:at(from,to)});
    const assignment=(operator,from,value,to)=>({...typed('bindingAssignment',from,to),operator,
      operatorRange:at(from+1,from+1+operator.length),
      target:{kind:'bindingTarget',type:'i32',binding:binding.id,range:at(from,from+1)},value});
    binding.writable=true;declaration.kind='letDeclaration';
    if(self){
      branch.range.end=start+9;returned.range.end=start+8;otherwise.range=at(9,17);otherwise.value.range=at(16,17);
    }
    const one={...original.right,range:self?at(6,7):at(3,4)};
    const rhs=self?{...typed('parentheses',3,8),expression:assignment('=',4,one,7)}:one;
    const compound=assignment('+=',0,rhs,self?8:4);
    returned.value=compound;
    if(mode!=='mixed')localInitializedUndefined(file,binding,declaration);
    file.sha256=sha256(file.content).slice(7);
    const factsBytes=derivedPacketBytes(packet),derived=readTypedArrayFacts(factsBytes);
    const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes,expectedPackageId:derived.packageId};
    const publication=buildInitialArrayPublication(context),built=buildHir(derived,context,publication);
    assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
    const owner=built.hir.functions.find(row=>row.name==='binary'),site=owner.id+'/body/2/then/0/value';
    const plan=buildFiniteCoreDomains(built.hir,context,{publicationContext:publication}).reached;
    const actual=node=>plan.domains.find(domain=>domain.id===plan.nodes.find(row=>row.id===node).domainId).actualTypes;
    const absent=sha256('tsfg.type\0undefined'),mixed=[absent,i32TypeId].sort();
    assert.deepEqual(actual(site+'/old-value'),mode==='mixed'?mixed:[absent]);
    assert.deepEqual(actual(site+'/value'),[i32TypeId]);
    assert.deepEqual(actual(site),mode==='mixed'?[i32TypeId]:[]);
    assert.deepEqual(actual(owner.id+'/return'),[i32TypeId]);
    if(self)assert.deepEqual(actual(owner.id+'/binding/'+binding.id),mixed);

    const lines=lowerFormalHir(built.hir,context,publication).split('\n');
    const anchor=({start,end})=>`tsfg_source.start = ${start} : i64, tsfg_source.end = ${end} : i64`;
    const matches=(op,range)=>lines.filter(line=>line.includes('"tsfg_core.'+op+'"(')&&line.includes(anchor(range)));
    const match=(op,range)=>matches(op,range)[0],rhsViews=matches('domain.view',rhs.range);
    const old=match('domain.view',compound.target.range),literal=match('constant',one.range),marker=rhsViews.at(-1),
      check=match('domain.numeric_use',compound.range),add=match('add',compound.range);
    assert.ok(old&&literal&&marker&&check&&add,mode);
    const originalOrder=[old,literal,marker,check,add].map(line=>lines.indexOf(line));
    assert.ok(originalOrder.every((at,index)=>index===0||at>originalOrder[index-1]),mode);
    const id=line=>line.trim().split(' = ')[0];
    assert.ok(check.includes(`(${id(old)})`)&&check.includes(`numeric_group = "${site}"`));
    assert.match(marker,/ : \(i32\) -> i32$/u);
    if(self){
      assert.equal(rhsViews.length,2);
      assert.ok(rhsViews[0].includes(`(${id(literal)})`)&&marker.includes(`(${id(rhsViews[0])})`));
      assert.ok(match('domain.view',one.range)?.includes(`(${id(literal)})`));
    }else assert.ok(marker.includes(`(${id(literal)})`));
    const [,label]=check.match(/\[\^(bb\d+)\]/u)??[];
    const successor=lines.findIndex(line=>line.trim().startsWith('^'+label+'('));
    const [,checked]=lines[successor].match(/\((%v\d+): i32\)/u)??[];
    assert.equal(lines[successor+1],add);
    assert.ok(checked&&add.includes(`(${checked}, ${id(marker)})`));
    assert.ok(lines.some(line=>line.includes(`"tsfg_core.domain.view"(${id(add)})`)&&line.includes(anchor(compound.range))));
    assert.ok(lines.some(line=>line.includes(`"func.return"(${id(add)})`)&&line.includes(anchor(returned.range))));
    const otherValue=match('constant',otherwise.value.range),otherReturn=lines.find(line=>line.includes('"func.return"(')&&line.includes(anchor(otherwise.range)));
    assert.ok(otherValue&&otherReturn?.includes(`(${id(otherValue)})`));
  }
});

test('finite local i32 updates check old values and preserve postfix and prefix payloads',()=>{
  const absent=sha256('tsfg.type\0undefined'),mixed=[absent,i32TypeId].sort();
  const modes=[{prefix:false,operator:'++'},{prefix:true,operator:'++'},{prefix:false,operator:'--'},
    {prefix:true,operator:'--'},{prefix:false,operator:'++',sequence:true},{prefix:false,operator:'++',terminal:true}];
  for(const {prefix,operator,sequence,terminal} of modes)for(const undefinedOnly of terminal?[true]:[false,true]){
    const packet=structuredClone(facts),payload=packet.payload,fn=payload.functions.find(row=>row.name==='binary');
    const binding=fn.bindings.find(row=>row.name==='x'),[,declaration,branch,otherwise]=fn.body,returned=branch.then[0];
    const file=payload.files.find(row=>row.path===fn.sourcePath),keyword=binding.nameRange.start-'const '.length;
    const replaceBranch=sequence||terminal;
    const start=replaceBranch?branch.range.start:returned.value.range.start,end=replaceBranch?otherwise.range.end:returned.range.end;
    const spelling=prefix?operator+'x':'x'+operator;
    const text=sequence?'if(use){x++;return x+=1}return 7':terminal?'return '+spelling+';':spelling+';';
    assert.equal(file.content.slice(keyword,keyword+5),'const');
    assert.equal(file.content.slice(start,end),replaceBranch?'if(use){return x+1;}\n  return 7;':'x+1;');
    assert.ok(text.length<=end-start);
    file.content=file.content.slice(0,keyword)+'let  '+file.content.slice(keyword+5,start)+text.padEnd(end-start)+file.content.slice(end);
    binding.writable=true;declaration.kind='letDeclaration';
    const at=(left,right)=>({start:start+left,end:start+right});
    const updateStart=sequence?8:terminal?7:0,target=updateStart+(prefix?2:0),op=updateStart+(prefix?0:1);
    const update={kind:'bindingUpdate',type:'i32',flowType:'i32',range:at(updateStart,updateStart+3),operator,prefix,
      target:{kind:'bindingTarget',type:'i32',binding:binding.id,range:at(target,target+1)},operatorRange:at(op,op+2)};
    if(terminal){
      returned.range=at(0,text.length);returned.value=update;
      fn.body.splice(2,2,returned);
    }else if(sequence){
      branch.range.end=start+24;
      const rhs={...returned.value.right,range:at(22,23)};
      const compound={kind:'bindingAssignment',type:'i32',flowType:'i32',range:at(19,23),operator:'+=',
        operatorRange:at(20,22),target:{...update.target,range:at(19,20)},value:rhs};
      branch.then=[{kind:'expression',range:at(8,12),value:update},{...returned,range:at(12,23),value:compound}];
      otherwise.range=at(24,32);otherwise.value.range=at(31,32);
    }else returned.value=update;
    if(undefinedOnly)localInitializedUndefined(file,binding,declaration);
    file.sha256=sha256(file.content).slice(7);
    const factsBytes=derivedPacketBytes(packet),derived=readTypedArrayFacts(factsBytes);
    const context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes,expectedPackageId:derived.packageId};
    const publication=buildInitialArrayPublication(context),built=buildHir(derived,context,publication);
    assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
    const owner=built.hir.functions.find(row=>row.name==='binary'),site=owner.id+
      (terminal?'/body/2/value':'/body/2/then/0/'+(sequence?'expression':'value'));
    const {reached:plan,definition}=buildFiniteCoreDomains(built.hir,context,{publicationContext:publication});
    const actual=node=>plan.domains.find(domain=>domain.id===plan.nodes.find(row=>row.id===node).domainId).actualTypes;
    const normal=undefinedOnly?[]:[i32TypeId];
    assert.deepEqual(actual(site+'/old-value'),undefinedOnly?[absent]:mixed);
    assert.deepEqual(actual(site+'/writeback/value'),normal);
    assert.deepEqual(actual(site),normal);
    assert.deepEqual(actual(owner.id+'/return'),terminal?[]:[i32TypeId]);
    const bindingNode=owner.id+'/binding/'+binding.id;
    assert.deepEqual(actual(bindingNode),undefinedOnly?[absent]:mixed);
    const storage=definition.carrierNodes.find(row=>row.id===bindingNode);
    assert.deepEqual(definition.domains.find(domain=>domain.id===storage.domainId).actualTypes,mixed);
    if(sequence){
      const next=owner.id+'/body/2/then/1/value';
      assert.deepEqual(actual(next+'/old-value'),normal);
      assert.deepEqual(actual(next),normal);
    }

    const lines=lowerFormalHir(built.hir,context,publication).split('\n');
    const anchor=({start,end})=>`tsfg_source.start = ${start} : i64, tsfg_source.end = ${end} : i64`;
    const match=(op,range)=>lines.find(line=>line.includes('"tsfg_core.'+op+'"(')&&line.includes(anchor(range)));
    const old=match('domain.view',update.target.range),unit=match('constant',update.range),
      check=match('domain.numeric_use',update.range),arithmetic=match(operator==='++'?'add':'sub',update.range);
    assert.ok(old&&unit&&check&&arithmetic);
    assert.match(unit,/value = 1 : i32,.* -> i32$/u);
    assert.ok(lines.indexOf(old)<lines.indexOf(unit)&&lines.indexOf(unit)<lines.indexOf(check));
    const id=line=>line.trim().split(' = ')[0];
    assert.ok(check.includes(`(${id(old)})`)&&check.includes(`numeric_group = "${site}"`));
    assert.match(check,/numeric_arity = 2 : i32, numeric_operand = 0 : i32/u);
    const [,label]=check.match(/\[\^(bb\d+)\]/u)??[];
    const success=lines.findIndex(line=>line.trim().startsWith('^'+label+'('));
    const [,oldNumber]=lines[success].match(/\((%v\d+): i32\)/u)??[];
    assert.ok(oldNumber&&lines[success+1]===arithmetic&&arithmetic.includes(`(${oldNumber}, ${id(unit)})`));
    const store=lines[success+2];
    assert.ok(store.includes(`"tsfg_core.domain.view"(${id(arithmetic)})`)&&store.includes(anchor(update.range))&&
      store.includes(`domain = "${storage.domainId}"`));
    if(!sequence)assert.ok(lines[success+3].includes(`"func.return"(${prefix?id(arithmetic):oldNumber})`));
    if(!terminal){
      const seven=match('constant',otherwise.value.range);
      assert.ok(seven&&lines.some(line=>line.includes(`"func.return"(${id(seven)})`)&&line.includes(anchor(otherwise.range))));
    }
  }
});

test('official initialized-undefined numeric facts preserve HIR and lower checked Core continuations',async()=>{
  assert.deepEqual(verifyHir(hir,context,publication),hir);
  assert.deepEqual(readHir(Buffer.from(printHir(hir,context,publication)),context,publication),hir);
  const core=lowerFormalHir(hir,context,publication);
  const checks=core.split('\n').filter(line=>line.includes('"tsfg_core.domain.numeric_use"'));
  assert.equal(checks.length,4);
  for(const [start,end] of [[235,238],[376,378],[490,501],[580,591]]) {
    const check=checks.find(line=>line.includes('tsfg_source.start = '+start+' : i64'));
    assert.ok(check,'missing full original numeric operation '+start);
    assert.ok(check.includes('tsfg_source.end = '+end+' : i64'));
    assert.ok(check.includes('trap_code = "r01-t-undefined-numeric-use"'));
    assert.ok(check.includes('rule_id = "r01-numeric-use"'));
    assert.ok(check.includes('numeric_operand = 0 : i32'));
    assert.match(check,/\)\[\^bb\d+\]/);
    assert.match(check,/-> \(\)$/);
  }
  assert.equal((core.match(/"tsfg_core.fuel"\(\) \{event = 1 : i32/g)??[]).length,5);
  if(process.env.TSFG_TEST_STORAGE) {
    await mkdir(process.env.TSFG_TEST_STORAGE,{recursive:true});
    await writeFile(path.join(process.env.TSFG_TEST_STORAGE,'core.mlir'),core,{flag:'wx'});
  }
});

test('normal numeric domains do not inherit undefined from the conditional physical ABI',()=>{
  const proofs=buildFiniteCoreDomains(hir,context,{publicationContext:publication});
  for(const plan of [proofs.reached,proofs.definition]) {
    const domains=new Map(plan.domains.map(domain=>[domain.id,domain]));
    const keep=hir.functions.find(fn=>fn.name==='keep');
    const returned=plan.nodes.find(node=>node.id===keep.id+'/return');
    assert.equal(domains.get(returned.domainId).actualTypes.length,2,'pure as/alias/return retains actual undefined');
    for(const expression of plan.expressions.filter(row=>['binary','unary'].includes(row.kind))) {
      const node=plan.nodes.find(node=>node.id===expression.id),domain=domains.get(node.domainId);
      assert.deepEqual(node.pending,[]);
      assert.deepEqual(domain.actualTypes,[expression.range.start===490||expression.range.start===484?boolTypeId:i32TypeId]);
    }
  }
});

test('actual Source i32 plus, operand order and U-only normal continuation use the accepted operation boundary',async t=>{
  const raw=await readFile(new URL('./testdata/typed-array-holder-parameter/numeric-use-order-package.json',import.meta.url));
  assert.equal(raw.length,23356);assert.equal(sha256(raw),'sha256:31d977221743664401bffcba459895e76ece4f42449570a42f7dedcaf8b2410b');
  const facts=readTypedArrayFacts(raw),context={family:'tsfg.array-facts-context-candidate',version:2,factsBytes:raw,expectedPackageId:facts.packageId};
  const publication=staticPublication(facts),built=buildHir(facts,context,publication);
  assert.equal(built.status,'ok',JSON.stringify(built.diagnostics));
  const hir=built.hir,proofs=buildFiniteCoreDomains(hir,context,{publicationContext:publication}),core=lowerFormalHir(hir,context,publication);
  const fn=name=>hir.functions.find(fn=>fn.name===name);
  for(const plan of [proofs.reached,proofs.definition]) {
    const domains=new Map(plan.domains.map(domain=>[domain.id,domain.actualTypes]));
    for(const name of ['plus','direct','caller']) {
      const returned=plan.nodes.find(node=>node.id===fn(name).id+'/return');
      assert.deepEqual(domains.get(returned.domainId),[],'U-only '+name+' cannot publish a successful return');
      assert.deepEqual(returned.pending,[],'proven numeric trap is distinct from unresolved analysis');
    }
    const result=plan.nodes.find(node=>node.id===fn('plusValue').id+'/return');
    assert.deepEqual(domains.get(result.domainId),[i32TypeId]);
  }
  const body=name=>{const start=core.indexOf('func.func @"f'+fn(name).id.slice(7)+'"');assert.ok(start>=0);const end=core.indexOf('func.func @',start+1);return core.slice(start,end<0?undefined:end);};
  const ordered=body('ordered'),left=ordered.indexOf('callee = @"f'+fn('left').id.slice(7)+'"'),right=ordered.indexOf('callee = @"f'+fn('right').id.slice(7)+'"'),check=ordered.indexOf('"tsfg_core.domain.numeric_use"');
  assert.ok(left>=0&&right>left&&check>right,'both actual calls precede the first consumption check');
  const rhs=body('rhsFails');assert.ok(rhs.indexOf('"tsfg_core.div"')<rhs.indexOf('"tsfg_core.domain.numeric_use"'),'RHS operation precedes outer operand consumption');
  assert.match(body('plus'),/"tsfg_core.pos"/,'checked unary plus retains an actual scalar consumer');
  if(process.env.TSFG_TEST_STORAGE)await writeFile(path.join(process.env.TSFG_TEST_STORAGE,'numeric-order-core.mlir'),core,{flag:'wx'});

  const numeric=proofs.reached.nodes.find(node=>node.id===fn('plus').id+'/return');
  const rhsTypes=proofs.reached.domains.find(domain=>domain.id===numeric.domainId).actualTypes;
  for(const [operator,literal,takesRight,completes] of [
    ['&&',true,true,false],['||',false,true,false],
    ['&&',false,false,true],['||',true,false,true],
    ['&&',undefined,true,true],['||',undefined,true,true],
  ]) await t.test(operator+' left '+String(literal),()=>{
    const nodes=new Map(),flow=finiteNormalFlow(true,()=>{},nodes),reached=new Set();
    const emit=(id,gate,types,dependencies=[])=>{
      flow.entry(id,gate);nodes.set(id,{actual:new Set(),pending:new Set()});flow.finish(id,dependencies);
      flow.publish(id,()=>{
        reached.add(id);
        for(const type of types)nodes.get(id).actual.add(type);
        flow.changed(id);
      });
      return id;
    };
    const operand={kind:literal===undefined?'reference':'boolean',value:literal};
    const value={kind:'shortCircuit',operator,left:{kind:'group',operand:{kind:'group',operand}}};
    let guardWork=0;
    const dependencies=finiteNormalLogical(value,flow,flow.always,(id,gate,propagatePending)=>{
      if(id==='right')assert.equal(propagatePending,takesRight,'only selectable operands supply pending facts');
      return emit(id,gate,id==='left'?[boolTypeId]:rhsTypes);
    },()=>{guardWork++;});
    assert.equal(guardWork,2);
    emit('result',flow.always,[boolTypeId],dependencies);
    emit('next',flow.normal('result'),[i32TypeId]);
    flow.seal();
    assert.ok(nodes.has('right'),'lexical right operand');
    assert.equal(reached.has('right'),takesRight,'right operand reachability');
    assert.equal(reached.has('next'),completes,'normal continuation');
  });
});
