// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { compilationClosure, moduleIdentity, normalizeClosure, rootKinds, printClosure } from "../../compiler/modules.mjs";
import { functionIdentity } from "../../compiler/identity.mjs";

function facts() {
  const functions = [], modules = [];
  for (const [index, kind] of rootKinds.entries()) {
    const path = `/src/${index}.ts`, leafPath = `/src/leaf-${index}.ts`;
    const initializer = { id: functionIdentity(path, "$moduleInit"), sourcePath: path,
      name: "$moduleInit", kind: "module-initialization", body: [], range: { start: 0, end: 99 } };
    const leafInitializer = { id: functionIdentity(leafPath, "$moduleInit"), sourcePath: leafPath,
      name: "$moduleInit", kind: "module-initialization", body: [], range: { start: 0, end: 99 } };
    const leaf = { id: functionIdentity(leafPath, "leaf"), sourcePath: leafPath,
      name: "leaf", kind: "source", body: [], range: { start: 10, end: 20 } };
    const fn = kind === "module-initialization" ? initializer : { id: functionIdentity(path, "entry"),
      sourcePath: path, name: "entry", kind: "source", body: [{ kind: "call", target: leaf.id }], range: { start: 12, end: 30 } };
    if (kind === "module-initialization") initializer.body.push({kind:"call",target:leaf.id});
    modules.push({ id: moduleIdentity(path), sourcePath: path, initializer: initializer.id, dependencies: [leafPath],exports:[] },
      { id: moduleIdentity(leafPath), sourcePath: leafPath, initializer: leafInitializer.id, dependencies: [],exports:[] });
    functions.push(initializer, leafInitializer, leaf);
    if (fn !== initializer) functions.push(fn);
  }
  const unused = { id: functionIdentity("/src/0.ts", "unused"), sourcePath: "/src/0.ts",
    name: "unused", kind: "source", body: [], range: { start: 50, end: 60 } };
  functions.push(unused);
  const roots = rootKinds.map((kind,index) => ({ kind, sourcePath: `/src/${index}.ts`,
    name: kind === "module-initialization" ? "$moduleInit" : "entry" }));
  return { functions, modules, configuration: { roots, requiredRoots: roots }, unused };
}

test("all six explicit root categories keep real owned call and initialization dependencies", () => {
  const input = facts(), closure = compilationClosure(input);
  assert.equal(closure.roots.length, 6);
  assert.equal(closure.modules.length, 12);
  assert.equal(closure.initialization.length, 12);
  assert.equal(closure.functions.length, input.functions.length - 1);
  assert.ok(!closure.functions.includes(input.unused.id));
  for (let index = 0; index < 6; index++) assert.ok(closure.initialization.indexOf(functionIdentity(`/src/leaf-${index}.ts`, "$moduleInit"))
    < closure.initialization.indexOf(functionIdentity(`/src/${index}.ts`, "$moduleInit")));
});

test("required callback and hot roots reject omission at original declaration anchors", () => {
  for (const kind of ["host-callback", "hot-function"]) {
    const input = facts();
    input.configuration.roots = input.configuration.roots.filter(root => root.kind !== kind);
    assert.throws(() => compilationClosure(input), error => error instanceof TypeError && 'code' in error
      && error.code === "r03-d-closure-root" && 'ruleId' in error && error.ruleId === "r01-compilation-closure"
      && 'primary' in error && error.primary && typeof error.primary==='object'
      && 'start' in error.primary && error.primary.start === 12);
  }
});

test("ordinary application does not implicitly require every embedding root category", () => {
  const input = facts();
  input.configuration.roots = input.configuration.roots.filter(root => root.kind === "application");
  input.configuration.requiredRoots = [];
  const closure = compilationClosure(input);
  assert.equal(closure.roots.length, 1);
  assert.equal(closure.modules.length, 2);
  assert.equal(closure.functions.length, 4);
});

test("source/module/function enumeration and root enumeration have canonical identity", () => {
  const input = facts(), baseline = printClosure(compilationClosure(input));
  input.modules.reverse(); input.functions.reverse(); input.configuration.roots.reverse(); input.configuration.requiredRoots.reverse();
  assert.equal(printClosure(compilationClosure(input)), baseline);
  assert.deepEqual(normalizeClosure(input.configuration).roots.map(root=>root.kind), [...rootKinds].sort());
});

test("legal static import cycle is retained while foreign module and call facts reject", () => {
  const input = facts();
  input.modules[1].dependencies = [input.modules[0].sourcePath];
  assert.equal(compilationClosure(input).initialization.length, 12);
  const changed = structuredClone(input);
  changed.modules[0].id = moduleIdentity("/src/foreign.ts");
  assert.throws(() => compilationClosure(changed), /r03-d-closure-dependency/);
  input.functions.find(fn=>fn.name==="entry").body[0].target = functionIdentity("/src/foreign.ts","absent");
  assert.throws(() => compilationClosure(input), /r03-d-closure-dependency/);
});

test("embedding roots resolve exported aliases to their owned function and owner initialization", () => {
  const input=facts();
  const target=input.functions.find(fn=>fn.sourcePath==="/src/leaf-0.ts" && fn.name==="leaf");
  input.modules[0].exports=[{name:"default",target:target.id}];
  input.configuration={roots:[{kind:"host-export",sourcePath:"/src/0.ts",name:"default"}],requiredRoots:[]};
  const closure=compilationClosure(input);
  assert.equal(closure.roots[0].target,target.id);
  assert.ok(closure.functions.includes(target.id));
  assert.deepEqual(closure.initialization,[functionIdentity("/src/leaf-0.ts","$moduleInit"),functionIdentity("/src/0.ts","$moduleInit")]);
  input.modules[0].exports[0].target=functionIdentity("/src/foreign.ts","leaf");
  assert.throws(()=>compilationClosure(input),/r03-d-closure-dependency/);
});

test("parameter defaults retain real call owners without executing unrelated modules", () => {
  const input = facts();
  input.configuration = {roots:[{kind:'application',sourcePath:'/src/0.ts',name:'entry'}],requiredRoots:[]};
  input.modules[0].dependencies = [];
  const entry = input.functions.find(fn => fn.sourcePath === '/src/0.ts' && fn.name === 'entry');
  const leaf = input.functions.find(fn => fn.sourcePath === '/src/leaf-0.ts' && fn.name === 'leaf');
  entry.body = [];
  entry.parameterInitializers = [{kind:'call',target:leaf.id}];
  const closure = compilationClosure(input);
  assert.deepEqual(closure.initialization, [input.modules[0].initializer, input.modules[1].initializer]);
  assert.ok(closure.functions.includes(leaf.id));
  assert.equal(closure.modules.length, 2);
  assert.ok(!closure.functions.includes(input.unused.id));
  entry.parameterInitializers[0].target = functionIdentity('/src/missing.ts','missing');
  assert.throws(() => compilationClosure(input), /r03-d-closure-dependency/);
});
