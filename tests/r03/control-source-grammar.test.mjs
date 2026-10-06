// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
import { compileHir, sourceInput, compileProgram, runBytecode } from "../../compiler/pipeline.mjs";
import { verifyHir, printHir, readHir, lowerHir } from "../../compiler/hir.mjs";
import { canonical } from "../../compiler/identity.mjs";
const tools = () => ({ frontend: process.env.TSFG_FRONTEND_EXE, core: process.env.TSFG_CORE_IR_EXE, vm: process.env.TSFG_VM_EXE });
async function checked(source) {
  const result = await compileHir(await sourceInput(source), tools());
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.doesNotThrow(() => lowerHir(result.hir));
  return structuredClone(result.hir);
}
function rejected(hir) {
  for (const admit of [verifyHir, printHir, lowerHir, value => readHir(Buffer.from(canonical(value)+"\n"))])
    assert.throws(() => admit(hir), /r03-hir-invalid/);
}
function misplacedUnary(expression) {
  const unary = structuredClone(expression.left);
  let innermost = unary;
  while (innermost.operand.kind === "unary") {
    innermost.range.end = expression.range.end;
    innermost = innermost.operand;
  }
  innermost.operand = { ...structuredClone(expression), left: innermost.operand,
    range: { start: innermost.operand.range.start, end: expression.range.end } };
  innermost.range.end = expression.range.end;
  unary.range.end = expression.range.end;
  return unary;
}
test("owned unary precedence rejects short circuit reattachment in return, if and while", async t => {
  for (const expression of ["!true && false", "!false || true", "!!true && false"])
    for (const context of ["return", "if", "while"]) await t.test(`${context}: ${expression}`, async () => {
      const source = context === "return" ? `export function answer(): bool { return ${expression}; }`
        : `export function answer(): i32 { ${context} (${expression}) return 1; return 2; }`;
      const hir = await checked(source), statement = hir.functions[0].body[0];
      const field = context === "return" ? "value" : "condition";
      statement[field] = misplacedUnary(statement[field]);
      rejected(hir);
    });
});
const operators = ["&&", "||", "===", "!=="];
// Independently enumerated literal results, in operator row/column order.
const expected = [[true,true,true,false],[true,true,true,true],[true,true,true,false],[false,true,false,true]];
test("owned boolean precedence and left association reject every opposite tree", async t => {
  for (const first of operators) for (const second of operators) await t.test(`${first} then ${second}`, async () => {
    const hir = await checked(`export function answer(): bool { return true ${first} true ${second} true; }`);
    const statement = hir.functions[0].body[0], root = statement.value;
    if (["binary", "shortCircuit"].includes(root.left.kind)) {
      const child = root.left;
      statement.value = { ...child, range: root.range, right: { ...root, left: child.right,
        range: { start: child.right.range.start, end: root.right.range.end } } };
    } else {
      const child = root.right;
      statement.value = { ...child, range: root.range, left: { ...root, right: child.left,
        range: { start: root.left.range.start, end: child.left.range.end } } };
    }
    rejected(hir);
  });
});
const dangling = [
  { label: "direct inner if", source: "if (true) if (false) return 1; else return 2; return 3;", path: ["thenBody",0] },
  { label: "while body", source: "if (true) while (true) if (false) return 1; else return 2; return 3;", path: ["thenBody",0,"body",0] },
  { label: "two while bodies", source: "if (true) while (true) while (true) if (false) return 1; else return 2; return 3;", path: ["thenBody",0,"body",0,"body",0] },
  { label: "matched inner if with open else tail", source: "if (true) if (false) return 1; else if (false) return 2; else return 3; return 4;", path: ["thenBody",0,"elseBody",0] },
  { label: "matched inner if with while else tail", source: "if (true) if (false) return 1; else while (true) if (false) return 2; else return 3; return 4;", path: ["thenBody",0,"elseBody",0,"body",0] },
];
test("owned dangling else rejects reattachment through direct, while and else-tail chains", async t => {
  for (const { label, source, path } of dangling) await t.test(label, async () => {
    const hir = await checked(`export function answer(): i32 { ${source} }`);
    const outer = hir.functions[0].body[0];
    let inner = outer;
    const ancestors = [];
    for (let index=0; index<path.length; index+=2) { inner = inner[path[index]][path[index+1]]; ancestors.push(inner); }
    assert.equal(inner.elseBody.length,1);
    outer.elseBody = inner.elseBody;
    inner.elseBody = [];
    const end = inner.thenBody[0].range.end;
    for (const ancestor of ancestors) ancestor.range.end = end;
    rejected(hir);
  });
});
/** @type {Array<[string, string, boolean|string, number]>} */
const valid = [
  ["bool", "return !(true && false);", true, 1],
  ["bool", "return !(false || true);", false, 1],
  ["bool", "return (!true) && false;", false, 1],
  ["bool", "return (!false) || true;", true, 1],
  ["bool", "return !true && false;", false, 1],
  ["bool", "return !false || true;", true, 1],
  ["bool", "return !!true && false;", false, 1],
  ["i32", "if (!true && false) return 1; return 2;", "2", 1],
  ["i32", "while (!true && false) return 1; return 2;", "2", 2],
  ["i32", "if (!false || true) return 1; return 2;", "1", 1],
  ["i32", "while (!false || true) return 1; return 2;", "1", 2],
  ["i32", dangling[0].source, "2", 1],
  ["i32", dangling[1].source, "2", 2],
  ["i32", dangling[2].source, "2", 3],
  ["i32", dangling[3].source, "3", 1],
  ["i32", dangling[4].source, "3", 2],
  ["i32", "if (false) if (false) return 1; else return 2; else return 3; return 4;", "3", 1],
  ["i32", "if (true) { if (false) return 1; } else return 2; return 3;", "3", 1],
  ["i32", "if (false) { if (false) return 1; } else return 2; return 3;", "2", 1],
  ["i32", "if (true) while (false) { if (false) return 1; } else return 2; return 3;", "3", 2],
  ["i32", "if (true) if (false) return 1; else return 2; else return 3; return 4;", "2", 1],
  ["i32", "if (false) while (true) if (false) return 1; else return 2; else return 3; return 4;", "3", 1],
  ["i32", "if (true) while (false) if (false) return 1; else return 2; else return 3; return 4;", "4", 2],
];
test("owned parentheses and brace barriers retain valid nearest-else trees", async t => {
  for (const [type, body] of valid) await t.test(body, async () => { await checked(`export function answer(): ${type} { ${body} }`); });
});
test("formal grammar goldens preserve independent results and entry or condition fuel", async t => {
  const cases=[...valid];
  for (const [i, first] of operators.entries()) for (const [j, second] of operators.entries())
    cases.push(["bool",`return true ${first} true ${second} true;`,expected[i][j],1]);
  for (const [type, body, value, fuel] of cases) await t.test(body, async () => {
    const source=`export function answer(): ${type} { ${body} }`;
    const result=await compileProgram(await sourceInput(source),tools());
    assert.equal(result.status,"ok",JSON.stringify(result));
    const [outcome]=await runBytecode(result.bytecode,{...tools(),requests:[{semanticFuel:fuel}]});
    assert.deepEqual(outcome.result,{type,value});
    assert.equal(outcome.fuelConsumed,String(fuel));
    assert.equal(outcome.fuelRemaining,"0");
  });
});
