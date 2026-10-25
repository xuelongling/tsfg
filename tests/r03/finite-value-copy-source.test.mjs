// SPDX-License-Identifier: MIT
// Real official packet → production memory constraints/Core. Numeric execution
// expectations stay frozen independently; no Source/C++/VM execution is claimed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readTypedArrayFacts} from '../../compiler/typed-array-facts.mjs';
import {buildHir,lowerFormalHir} from '../../compiler/hir.mjs';
import {buildFiniteCoreDomains} from '../../compiler/finite-actual-domains.mjs';
import {sha256} from '../../compiler/identity.mjs';
import {invokeCore,accepted,rejected} from './generic-core-package-capture.mjs';
import {staticPublication} from './typed-array-publication-fixtures.mjs';
import expected from './testdata/typed-array-entry/value-copy-expected.json' with {type:'json'};

test('actual frozen Source copies isolate value fields and preserve child mutations across calls',async t=>{
  const bytes=await readFile(new URL('./testdata/typed-array-entry/'+expected.source.sha256+'-package.json',import.meta.url));
  assert.equal(bytes.length,37864);assert.equal(sha256(bytes),'sha256:5695d8b84a047bb9f73e0e4d54d791e1fa2e241d29cd29a54a3a759158d68d54');
  const facts=readTypedArrayFacts(bytes),context={family:'tsfg.array-facts-context-candidate',version:2,
    factsBytes:bytes,expectedPackageId:facts.packageId},publication=staticPublication(facts),built=buildHir(facts,context,publication);assert.equal(built.status,'ok');
  const hir=built.hir,source=hir.sources.find(row=>row.path==='/src/main.ts');assert.equal(source.content,expected.source.text);
  assert.equal(sha256(source.content),'sha256:'+expected.source.sha256);
  const plan=buildFiniteCoreDomains(hir,context,{publicationContext:publication}).definition,core=lowerFormalHir(hir,context,publication),
    value=hir.types.find(row=>row.kind==='value'),field=value.fields.find(row=>source.content.slice(row.range?.start,row.range?.end).startsWith('x:'))??value.fields[0];
  const expressions=new Map();
  for(const fn of hir.functions) {
    const pending=[{value:fn.body,path:fn.id+'/body'}];
    while(pending.length) {
      const {value,path}=pending.pop();if(!value||typeof value!=='object')continue;
      if(value.kind)expressions.set(path,value);
      for(const [key,child] of Object.entries(value))if(child&&typeof child==='object')pending.push({value:child,path:path+'/'+key});
    }
  }
  const text=value=>source.content.slice(value.range.start,value.range.end),
    write=(fnName,expression)=>{
      const fn=hir.functions.find(row=>row.name===fnName),row=[...expressions].find(([path,value])=>path.startsWith(fn.id+'/')&&value.kind==='fieldAssignment'&&text(value)===expression);
      assert.ok(row,expression);const selection=plan.carrierFields.find(field=>field.id===row[0]);assert.ok(selection);
      return row[0]+'/field-version/'+selection.targets[0].actualType+'/'+selection.targets[0].fieldId;
    },
    expectRead=(fnName,expression,version)=>{
      const fn=hir.functions.find(row=>row.name===fnName),rows=[...expressions].filter(([path,value])=>path.startsWith(fn.id+'/')&&value.kind==='fieldAccess'&&text(value)===expression);
      assert.ok(rows.length,fnName+': '+expression);
      for(const [path] of rows) {
        const read=plan.fieldReaching.reads.find(row=>row.node===path);assert.ok(read);assert.ok(read.reaching.length,fnName+': '+expression);
        for(const row of read.reaching)assert.ok(row.versions.length&&row.versions.every(id=>version(id)),fnName+': '+expression+' '+JSON.stringify(row));
      }
    },
    initialized=id=>id.startsWith(value.construction.id+'/field/'+field.id+'/version/');
  expectRead('f','a.x',initialized);expectRead('f','a.child.n',id=>id===write('f','b.child.n=3'));
  expectRead('g','a.x',initialized);expectRead('g','a.child.n',id=>id===write('change','p.child.n=9'));
  expectRead('change','p.x',id=>id===write('change','p.x=7'));
  expectRead('h','a.x',initialized);expectRead('h','b.x',id=>id===write('h','b.x=2'));
  for(const name of ['f','g','h','pass','valueAt']) {
    const fn=hir.functions.find(row=>row.name===name),body=core.split('  func.func @"f'+fn.id.slice(7)+'"')[1].split('\n  }')[0];
    assert.match(body,/"tsfg_core.domain.copy"/,name+' retains its real copy boundary');
    if(name==='valueAt')assert.ok(body.indexOf('"tsfg_core.domain.array_read"')<body.indexOf('"tsfg_core.domain.copy"'));
  }
  assert.deepEqual(expected.normalResults,{f:4,g:17,h:4,valueAt:'by-value existing admitted V element after actual checked read success'});
  if(process.env.TSFG_CORE_IR_EXE) {
    await t.test('real Core closes the complete value-copy proof within its ordinary work budget',async()=>{
      const first=await invokeCore(core);accepted(first);
      const second=await invokeCore(first.stdout);accepted(second);assert.deepEqual(second.stdout,first.stdout);
    });
    await t.test('real Core rejects a stale predecessor from the other value plane',async()=>{
      const fn=hir.functions.find(row=>row.name==='h'),body=core.split('  func.func @"f'+fn.id.slice(7)+'"')[1].split('\n  }')[0];
      const reads=[...expressions.values()].filter(value=>value.kind==='fieldAccess'&&['a.x','b.x'].includes(text(value)));
      const lineFor=expression=>{
        const value=reads.find(value=>text(value)===expression&&body.includes('tsfg_source.start = '+value.range.start+' : i64'));
        assert.ok(value);const line=body.split('\n').find(line=>line.includes('"tsfg_core.domain.field_read"')&&
          line.includes('tsfg_source.start = '+value.range.start+' : i64')&&line.includes('tsfg_source.end = '+value.range.end+' : i64'));
        assert.ok(line);return line;
      };
      const original=lineFor('b.x'),other=lineFor('a.x'),pattern=/field_reaching = ("(?:[^"\\]|\\.)*")/;
      const selected=pattern.exec(other);assert.ok(selected);
      const changed=original.replace(pattern,()=>selected[0]);assert.notEqual(changed,original);
      const result=await invokeCore(core.replace(original,()=>changed));rejected(result);
      assert.match(result.stderr.toString('utf8'),/claimed field version is stale or not first/);
    });
  }
});
