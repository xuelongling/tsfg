// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { compileProgram, sourceInput, runBytecode, createCompilerSession } from '../../compiler/pipeline.mjs';
import { printHir, readHir, lowerHir } from '../../compiler/hir.mjs';
const tools = () => ({ frontend: process.env.TSFG_FRONTEND_EXE, core: process.env.TSFG_CORE_IR_EXE, vm: process.env.TSFG_VM_EXE });
const value = (type, bits) => ({ type, value: bits });
async function compiled(source, optimize = false) {
    const program = await compileProgram(await sourceInput(source), { ...tools(), optimize });
    assert.equal(program.status, 'ok', JSON.stringify(program));
    return program;
}

test('float source contexts reject nominal conversion and preserve overflow literal anchors', async () => {
    for (const source of [
        'function main(a:f32,b:f64):f32{return a+b;}',
        'function main(a:f32):f32{return ~a;}',
        'function main(a:f64):f64{return a<<1;}',
        'function main(a:i32):f64{return a;}',
        'function main(a:f32):f64{return a;}',
    ]) {
        const actual = await compileProgram(await sourceInput(source), tools());
        assert.equal(actual.status, 'error');
        assert.ok(actual.diagnostics.some(diagnostic => diagnostic.code === 'r01-d-scalar-type'));
        assert.equal(actual.bytecode, undefined);
    }
    for (const source of [
        '/*😀*/ function main():f32{return /*overflow*/ (1e1000);}',
        'function main():f64{const x:f64=1e1000;return x;}',
        'function main():f32{let x:f32=0.0;x=1e1000;return x;}',
        'function main():f64{return pass(1e1000);}function pass(a:f64):f64{return a;}',
    ]) {
        const actual = await compileProgram(await sourceInput(source), tools());
        assert.equal(actual.status, 'error');
        const diagnostic = actual.diagnostics.find(item => item.code === 'r01-d-float-range');
        assert.ok(diagnostic, JSON.stringify(actual));
        assert.equal(source.slice(diagnostic.primary.start, diagnostic.primary.end), '1e1000');
        assert.equal(actual.bytecode, undefined);
    }
    for (const source of [
        'function main():f64{const a=0.1;return a;}',
        'function main():f32{const a:f32=16777217;return a;}',
        'function main(a:number):number{return a+0.1;}',
        '/*😀*/ function main():f32{return /*round*/ (1.0000000596046447753906251);}',
    ]) await compiled(source);
});
test('default f64 survives grouped and nested arithmetic source metamorphisms', async () => {
    // Exact f64 inputs for 0.1 and 0.2 are respectively
    // 3602879701896397/2^55 and 3602879701896397/2^54. Their sum
    // is a tie with an odd lower significand, so RNE selects ...3334;
    // directly rounded 0.3 is ...3333. Other rows are exact integers/zero.
    /** @type {[string, string | boolean, string[]][]} */
    const rows = [
        ['f64', '3fd3333333333334', ['0.1+0.2', '(0.1)+(0.2)', '((0.1)+((0.2)))']],
        ['f64', 'bfb999999999999a', ['-0.1', '-(0.1)', '-((0.1))']],
        ['f64', '3ff0000000000000', ['+1e0', '+((1e0))']],
        ['f64', '4008000000000000', ['1e0+2e0', '((1e0))+((2e0))', '+(1e0)+(2.0)']],
        ['f64', 'c008000000000000', ['-(1e0+2.0)', '-((1e0)+(2.0))']],
        ['f64', '4018000000000000', ['1+2+3e0', '((1)+(2))+((3e0))']],
        ['f64', '8000000000000000', ['-0.0', '-((0.0))']],
        ['bool', false, ['(0.1+0.2)===(0.3+0.0)', '((0.1)+(0.2))===((0.3)+(0.0))']],
        ['bool', true, ['(1e0<2e0)===(2.0>1.0)', '((1e0)<(2e0))===((2.0)>(1.0))']],
    ];
    const root = await mkdtemp(path.join(process.env.TSFG_MLIR_TEST_TEMP_ROOT, 'r03-float-grouping-'));
    let index = 0;
    async function execute(source, optimize, expected, args = []) {
        const input = await sourceInput(source);
        const program = await compileProgram(input, { ...tools(), optimize });
        assert.equal(program.status, 'ok', JSON.stringify(program));
        const requests = [{ arguments: args }];
        const responses = await runBytecode(program.bytecode, { ...tools(), requests });
        const argumentsJson = JSON.stringify(requests);
        const command = ['--requests', argumentsJson];
        const raw = spawnSync(tools().vm, command, { input: program.bytecode, windowsHide: true });
        assert.ifError(raw.error);
        await writeFile(path.join(root, `${index++}.json`), JSON.stringify({ source, input, optimize, expected,
            hir: program.hir, core: program.core, bytecodeBase64: program.bytecode.toString('base64'),
            requests, responses, raw: { executable: tools().vm, args: command, status: raw.status, signal: raw.signal,
                stdoutBase64: raw.stdout.toString('base64'), stderrBase64: raw.stderr.toString('base64') } }, null, 2) + '\n');
        assert.equal(raw.status, 0, raw.stderr.toString());
        assert.deepEqual(JSON.parse(raw.stdout.toString()), responses);
        assert.deepEqual(responses[0].result, expected, source);
        assert.equal(printHir(readHir(Buffer.from(printHir(program.hir)))), printHir(program.hir));
    }
    for (const optimize of [false, true]) {
        for (const [type, bits, expressions] of rows) {
            for (const expression of expressions) {
                const source = `function main():${type}{const a=${expression};return a;}`;
                await execute(source, optimize, value(type, bits));
            }
        }
        /** @type {[string, {type:string, value:string}[], string][]} */
        const contexts = [
            ['function main(a:f32):f32{const b=(1.0)+(a);return b;}', [value('f32', '3f800000')], '40000000'],
            ['function main(a:f32):f32{const b=-((1.0)+(a));return b;}', [value('f32', '3f800000')], 'c0000000'],
            ['function main():f32{const a:f32=((1.0)+(2.0));return a;}', [], '40400000'],
            ['function main():f32{const b=((1.0))+(one());return b;}function one():f32{return 1.0;}', [], '40000000'],
        ];
        for (const [source, args, bits] of contexts) {
            await execute(source, optimize, value('f32', bits), args);
        }
    }
    console.log(`Grouped float execution evidence ${root}: ${index} programs`);
});
test('grouped float defaults preserve typed precedence and first diagnostic identities and anchors', async () => {
    /** @type {[string, string, string, number, number][]} */
    const cases = [
        ['function main():i32{const a:i32=(0.1)+(0.2);return a;}', 'r01-d-scalar-type', 'const a', 6, 1],
        ['function main(a:i32):i32{const b=(0.1)+(a);return b;}', 'r02b-d-type', 'return', 0, 6],
        ['function main(a:f32,b:f64):f32{const c=((a))+((b));return c;}', 'r02b-d-type', 'return', 0, 6],
        ['function main():f32{const a=(1.0)+(2.0);return(a);}', 'r01-d-scalar-type', 'return', 0, 6],
        ['function main(a:f32):f64{const b=(1e1000)+(a);return(b);}', 'r01-d-float-range', '1e1000', 0, 6],
        ['function main(a:f32,b:f64):f32{return((b)+(1e1000));}', 'r01-d-scalar-type', 'return', 0, 6],
        ['/*😀*/function main():i32{const a:i32=(0.1)+(1e1000);return(a);}', 'r01-d-scalar-type', 'const a', 6, 1],
    ];
    const records = [];
    for (const [source, code, anchor, offset, length] of cases) {
        const input = await sourceInput(source);
        const actual = await compileProgram(input, tools());
        records.push({ source, input, expected: { code, anchor, offset, length }, actual });
        assert.equal(actual.status, 'error', source);
        assert.equal(actual.bytecode, undefined);
        const first = actual.diagnostics[0];
        const baseline = code === 'r02b-d-type';
        assert.equal(first.code, code, source);
        assert.equal(first.phase, baseline ? 'syntax' : 'types');
        assert.equal(first.ruleId, baseline ? 'r01-ts-baseline' : 'r01-literals');
        assert.deepEqual(first.ruleIds, [first.ruleId]);
        assert.equal(first.category, 'error');
        assert.equal(first.severity, 'error');
        const start = source.indexOf(anchor) + offset, end = start + length;
        assert.deepEqual(first.range, { start, end });
        assert.equal(first.primary.start, start);
        assert.equal(first.primary.end, end);
        assert.equal(first.primary.sourceId, '/src/main.ts');
        assert.equal(first.primary.startColumn, start);
        assert.equal(first.primary.endColumn, end);
    }
    const root = await mkdtemp(path.join(process.env.TSFG_MLIR_TEST_TEMP_ROOT, 'r03-float-grouping-negatives-'));
    await writeFile(path.join(root, 'diagnostics.json'), JSON.stringify(records, null, 2) + '\n');
    console.log(`Grouped float diagnostic evidence ${root}: ${records.length} cases`);
});
test('float call, branch phi, local and return transport preserves signaling NaNs, payloads and signed zero', async () => {
    for (const type of ['f32', 'f64'])
        for (const optimize of [false, true]) {
            const p = await compiled(`function main(a:${type}, flag:bool):${type} {let v:${type}=a; if(flag){v=pass(a);}else{v=a;}return v;} function pass(a:${type}):${type}{return a;}`, optimize);
            const bits = type === 'f32' ? ['7f800001', 'ffc12345', '80000000', '7f800000'] : ['7ff0000000000001', 'fff8123456789abc', '8000000000000000', '7ff0000000000000'];
            const requests = bits.flatMap(raw => [true, false].map(flag => ({ arguments: [value(type, raw), value('bool', flag)], depth: 2 })));
            const results = await runBytecode(p.bytecode, { ...tools(), requests });
            for (const [i, result] of results.entries())
                assert.deepEqual(result.result, value(type, bits[Math.floor(i / 2)]));
            assert.deepEqual(await runBytecode(p.bytecode, { ...tools(), command: '--roundtrip' }), p.bytecode);
            assert.equal(printHir(readHir(Buffer.from(printHir(p.hir)))), printHir(p.hir));
        }
});
test('unary float arithmetic canonicalizes NaN and each operation rounds before subsequent arithmetic', async () => {
    for (const type of ['f32', 'f64'])
        for (const optimize of [false, true]) {
            for (const op of ['+', '-']) {
                const p = await compiled(`function main(a:${type}):${type}{return ${op}a;}`, optimize);
                const [r] = await runBytecode(p.bytecode, { ...tools(), requests: [{ arguments: [value(type, type === 'f32' ? 'ff800001' : 'fff0000000000001')] }] });
                assert.deepEqual(r.result, value(type, type === 'f32' ? '7fc00000' : '7ff8000000000000'));
            }
            // Exact mathematics: (1+2^-p)*(1-2^-p)=1-2^(-2p), which rounds to 1;
            // subtracting 1 then yields +0. A fused operation would retain the negative term.
            const p = await compiled(`function main(a:${type},b:${type},c:${type}):${type}{return a*b+c;}`, optimize);
            const inputs = type === 'f32' ? ['3f800001', '3f7ffffe', 'bf800000'] : ['3ff0000000000001', '3feffffffffffffe', 'bff0000000000000'];
            const [r] = await runBytecode(p.bytecode, { ...tools(), requests: [{ arguments: inputs.map(b => value(type, b)) }] });
            assert.deepEqual(r.result, value(type, type === 'f32' ? '00000000' : '0000000000000000'));
        }
});
test('float request preflight rejects malformed and wrong nominal bit frames before depth/fuel events', async () => {
    for (const type of ['f32', 'f64']) {
        const p = await compiled(`function main(a:${type}):${type}{return a;}`);
        const good = type === 'f32' ? '3f800000' : '3ff0000000000000';
        const invalid = [value(type, '0x' + good), value(type, good.toUpperCase()), value(type, good.slice(1)), value(type, '+' + good), value(type, 1), { type, value: good, extra: 0 }, value(type === 'f32' ? 'f64' : 'f32', good)];
        const results = await runBytecode(p.bytecode, { ...tools(), requests: invalid.map(a => ({ arguments: [a], depth: 0, semanticFuel: 0, instructionBudget: 0 })) });
        for (const r of results) {
            assert.equal(r.code, 'r05-request-arguments');
            assert.equal(r.fuelConsumed, '0');
            assert.equal(r.activeRequests, '0');
        }
    }
});
test('current float cold/incremental/optimized results, HIR/Core printing and verifier identities agree', async () => {
    for (const type of ['f32', 'f64']) {
        const source = `function main(a:${type}):${type}{let sum:${type}=0.0;let n:i32=0;while(n<3){sum=add(sum,a);n=n+1;}return sum;} function add(a:${type},b:${type}):${type}{return a+b;}`;
        const input = await sourceInput(source), session = createCompilerSession(tools());
        const first = await session.compile(input), second = await session.compile(input), full = await compileProgram(input, tools()), optimized = await compileProgram(input, { ...tools(), optimize: true });
        for (const p of [first, second, full, optimized])
            assert.equal(p.status, 'ok', JSON.stringify(p));
        assert.deepEqual(first.bytecode, second.bytecode);
        assert.deepEqual(first.bytecode, full.bytecode);
        assert.equal(lowerHir(readHir(Buffer.from(printHir(first.hir)))), lowerHir(first.hir));
        for (const p of [first, optimized]) {
            const [r] = await runBytecode(p.bytecode, { ...tools(), requests: [{ arguments: [value(type, type === 'f32' ? '3f800000' : '3ff0000000000000')], depth: 2, semanticFuel: 8 }] });
            assert.deepEqual(r.result, value(type, type === 'f32' ? '40400000' : '4008000000000000'));
        }
    }
    const p = await compiled('function main():f32{return 0.1;}');
    const bad = structuredClone(p.hir);
    bad.functions[0].body[0].value.bits = '00000000';
    assert.throws(() => readHir(Buffer.from(JSON.stringify(bad))), /r03-hir-/);
    for (const core of [p.core.replace('3dcccccd', '3DCCCCCD'), p.core.replace('3dcccccd', '000000003dcccccd'), p.core.replace('tsfg_core.constant', 'tsfg_core.pos')]) {
        const r = spawnSync(tools().core, ['--emit-bytecode'], { input: core, windowsHide: true });
        assert.ifError(r.error);
        assert.notEqual(r.status, 0);
    }
    const bytes = Buffer.from(p.bytecode);
    const at = bytes.length - 40;
    assert.equal(bytes[at], 32);
    bytes[at + 20] = 1;
    createHash('sha256').update(bytes.subarray(80)).digest().copy(bytes, 48);
    const rejected = spawnSync(tools().vm, ['--inspect'], { input: bytes, windowsHide: true });
    assert.equal(rejected.status, 3);
    assert.match(rejected.stderr.toString(), /r04-float-bits/);
});
