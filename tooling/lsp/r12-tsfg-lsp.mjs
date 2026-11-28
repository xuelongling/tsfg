// SPDX-License-Identifier: MIT
// R12 Production `tsfg-lsp`: Full JSON-RPC 2.0 Language Server over stdio (and programmatic API)
// merging TypeScript syntax/type rules with tsfg semantic, kernel (`@component`/`@system`/`@gpu_kernel`),
// ABI, and hot-reload diagnostics, plus workspace cross-file + `.tpkg` hover, definition,
// completion, documentSymbol, signatureHelp, and references.
import { pathToFileURL } from 'node:url';

const TSFG_COMPLETION_BUILTINS = [
  { label: 'i32', kind: 25, detail: '32-bit signed integer (fixed-width)' },
  { label: 'i64', kind: 25, detail: '64-bit signed integer (fixed-width)' },
  { label: 'u32', kind: 25, detail: '32-bit unsigned integer (fixed-width)' },
  { label: 'u64', kind: 25, detail: '64-bit unsigned integer (fixed-width)' },
  { label: 'f32', kind: 25, detail: '32-bit IEEE 754 float (strict)' },
  { label: 'f64', kind: 25, detail: '64-bit IEEE 754 float (strict)' },
  { label: 'ReadSpan', kind: 8, detail: 'ReadSpan<T> non-escaping readonly array borrow' },
  { label: 'Span', kind: 8, detail: 'Span<T> non-escaping mutable array borrow' },
  { label: 'Query', kind: 8, detail: 'Query<[Write<T>, Read<U>]> ECS archetype query' },
  { label: 'Read', kind: 8, detail: 'Read<T> immutable ECS component access' },
  { label: 'Write', kind: 8, detail: 'Write<T> exclusive mutable ECS component access' },
  { label: 'Handle', kind: 8, detail: 'Handle<T> generation-checked entity handle' },
  { label: '@value', kind: 14, detail: 'Value-semantics class decorator' },
  { label: '@component', kind: 14, detail: 'ECS SoA component decorator' },
  { label: '@system', kind: 14, detail: 'ECS parallel system decorator' },
  { label: '@gpu_kernel', kind: 14, detail: 'Vulkan 1.3 SPIR-V compute kernel decorator' },
  { label: '@abi', kind: 14, detail: 'Native C/Zig ABI boundary decorator' },
];

export function analyzeTsfgDocument(uri, text, prevSymbols = null) {
  const diagnostics = [];
  const symbols = new Map(); // name -> { name, kind, lspKind, line, col, params, detail, uri }
  const lines = text.split(/\r?\n/);

  const pushDiag = (line, startCol, endCol, code, severity, message) => {
    diagnostics.push({
      code,
      message,
      range: {
        start: { line, character: startCol },
        end: { line, character: Math.max(startCol + 1, endCol) },
      },
      severity, // 1 = Error, 2 = Warning
      source: 'tsfg-lsp',
    });
  };

  let activeDecorator = null;
  let activeDeclName = null;
  let braceDepth = 0;
  let inBlockDecorator = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) continue;

    // Track decorators (`@component`, `@value`, `@abi`, `@system`, `@gpu_kernel`, `@tsfgValue`, `@tsfgComponent`)
    const dec = line.match(/@(component|value|abi|system|gpu_kernel|tsfgValue|tsfgComponent)\b/);
    if (dec) {
      activeDecorator = dec[1] === 'tsfgValue' ? 'value' : dec[1] === 'tsfgComponent' ? 'component' : dec[1];
    }

    // Track class / interface / function declarations for hover, definition, completion, documentSymbol
    const classMatch = line.match(/\b(?:export\s+|declare\s+)?(?:class|interface)\s+([A-Za-z_]\w*)/);
    if (classMatch) {
      const name = classMatch[1];
      const col = line.indexOf(name);
      symbols.set(name, {
        name,
        kind: activeDecorator ? `@${activeDecorator} class` : 'class',
        lspKind: 5, // Class
        line: i,
        col,
        params: '',
        detail: `${activeDecorator ? `@${activeDecorator} ` : ''}class ${name}`,
        uri,
      });
      inBlockDecorator = activeDecorator;
      activeDeclName = name;
      activeDecorator = null;
    }

    const fnMatch = line.match(/\b(?:export\s+|declare\s+)?function\s+([A-Za-z_]\w*)\s*\(([^)]*)\)(?:\s*:\s*([^{;]+))?/);
    if (fnMatch) {
      const name = fnMatch[1];
      const params = fnMatch[2];
      const retTy = fnMatch[3]?.trim() ?? 'void';
      const col = line.indexOf(name);
      symbols.set(name, {
        name,
        kind: activeDecorator ? `@${activeDecorator} function` : 'function',
        lspKind: 12, // Function
        line: i,
        col,
        params,
        detail: `${activeDecorator ? `@${activeDecorator} ` : ''}function ${name}(${params}): ${retTy}`,
        uri,
      });
      inBlockDecorator = activeDecorator;
      activeDeclName = name;
      activeDecorator = null;

      // `@system` Query Read/Write intra-system alias check
      if (inBlockDecorator === 'system') {
        const accesses = [...params.matchAll(/(Read|Write)<\s*([A-Za-z_]\w*)\s*>/g)];
        const seen = new Map();
        for (const m of accesses) {
          const mode = m[1];
          const comp = m[2];
          const prev = seen.get(comp);
          if (prev && (prev === 'Write' || mode === 'Write')) {
            pushDiag(i, col, col + name.length, 'r10-query-alias-conflict', 1, `@system ${name} aliases ${comp} with conflicting ${prev}/${mode}`);
          }
          seen.set(comp, mode);
        }
      }
    }

    // Standard TS + tsfg forbidden constructs
    const anyIdx = line.search(/:\s*any\b|\bas\s+any\b|<any>/);
    if (anyIdx >= 0) {
      pushDiag(i, anyIdx, anyIdx + 5, 'r02b-forbid-any', 1, 'tsfg forbids `any`; specify a static fixed type');
    }
    const evalIdx = line.search(/\beval\s*\(|new\s+Function\s*\(/);
    if (evalIdx >= 0) {
      pushDiag(i, evalIdx, evalIdx + 4, 'r02b-forbid-eval', 1, 'tsfg forbids dynamic eval/Function');
    }
    const proxyIdx = line.search(/\bnew\s+Proxy\s*\(/);
    if (proxyIdx >= 0) {
      pushDiag(i, proxyIdx, proxyIdx + 9, 'r01-forbid-proxy', 1, 'tsfg forbids Proxy');
    }
    const looseEqIdx = line.search(/[^=!<>]==[^=]|[^!]!=[^=]/);
    if (looseEqIdx >= 0) {
      pushDiag(i, looseEqIdx + 1, looseEqIdx + 3, 'r01-forbid-loose-eq', 1, 'tsfg forbids loose equality (`==`/`!=`); use `===`/`!==`');
    }
    const jsImp = line.match(/from\s+['"]([^'"]+\.(?:m?js|cjs))['"]/);
    if (jsImp) {
      const idx = line.indexOf(jsImp[1]);
      pushDiag(i, idx, idx + jsImp[1].length, 'r02b-forbid-js-import', 1, 'tsfg forbids importing .js/.mjs/.cjs modules');
    }

    // Kernel-specific semantic diagnostics inside `@component`, `@value`, `@gpu_kernel`, `@system`
    if (inBlockDecorator === 'component' || inBlockDecorator === 'value') {
      const badField = line.match(/^\s*([A-Za-z_]\w*)\s*:\s*(string|object|unknown|Function)\b/);
      if (badField) {
        const col = line.indexOf(badField[2]);
        pushDiag(
          i,
          col,
          col + badField[2].length,
          'r10-component-nonvalue',
          1,
          `@${inBlockDecorator} ${activeDeclName}.${badField[1]} cannot use managed/non-value type '${badField[2]}'`,
        );
      }
    }
    if (inBlockDecorator === 'gpu_kernel' || inBlockDecorator === 'system') {
      const badThrow = line.search(/\bthrow\b|\bawait\b|\bnew\s+[A-Z]/);
      if (badThrow >= 0) {
        const code = inBlockDecorator === 'gpu_kernel' ? 'r11-gpu-illegal-effect' : 'r10-kernel-illegal-effect';
        pushDiag(i, badThrow, badThrow + 5, code, 1, `@${inBlockDecorator} ${activeDeclName} forbids throw/await/managed allocation`);
      }
    }

    for (const ch of line) {
      if (ch === '{') braceDepth += 1;
      else if (ch === '}') {
        braceDepth = Math.max(0, braceDepth - 1);
        if (braceDepth === 0) {
          inBlockDecorator = null;
          activeDeclName = null;
        }
      }
    }
  }

  // Hot-reload compatibility warning if a previously declared function changed signature
  if (prevSymbols) {
    for (const [name, sym] of symbols.entries()) {
      const old = prevSymbols.get(name);
      if (old && old.kind === sym.kind && old.detail !== sym.detail && sym.kind.includes('function')) {
        pushDiag(
          sym.line,
          sym.col,
          sym.col + name.length,
          'r09-hot-reload-signature-change',
          2,
          `Hot-reload warning: signature of '${name}' changed; function-level patch will be rejected unless module reload is used`,
        );
      }
    }
  }

  return { diagnostics, symbols, uri };
}

function applyIncrementalChanges(text, changes) {
  let cur = text;
  for (const ch of changes) {
    if (!ch.range) {
      cur = ch.text;
      continue;
    }
    const lines = cur.split('\n');
    const sLine = ch.range.start.line;
    const sChar = ch.range.start.character;
    const eLine = ch.range.end.line;
    const eChar = ch.range.end.character;
    const prefix = (lines[sLine] ?? '').slice(0, sChar);
    const suffix = (lines[eLine] ?? '').slice(eChar);
    lines.splice(sLine, eLine - sLine + 1, prefix + ch.text + suffix);
    cur = lines.join('\n');
  }
  return cur;
}

export class TsfgLspServer {
  constructor() {
    this.documents = new Map(); // uri -> { text, diagnostics, symbols }
    this.packageSymbols = new Map(); // symbolName -> { ...sym }
    this.initialized = false;
    this.shutdownRequested = false;
  }

  /** Register declarations from a loaded precompiled `.tpkg` so cross-package hover/definition/completion work! */
  registerPackageDeclarations(pkgName, dtsText) {
    const uri = `tsfg-pkg:///${pkgName}.d.ts`;
    const analysis = analyzeTsfgDocument(uri, dtsText, null);
    for (const [name, sym] of analysis.symbols.entries()) {
      this.packageSymbols.set(name, sym);
    }
  }

  _lookupSymbol(doc, word) {
    if (!word) return null;
    if (doc?.symbols.has(word)) return doc.symbols.get(word);
    for (const other of this.documents.values()) {
      if (other.symbols.has(word)) return other.symbols.get(word);
    }
    if (this.packageSymbols.has(word)) return this.packageSymbols.get(word);
    return null;
  }

  handleMessage(msg) {
    const { id, method, params } = msg;
    if (method === 'initialize') {
      this.initialized = true;
      return {
        id,
        jsonrpc: '2.0',
        result: {
          capabilities: {
            completionProvider: { triggerCharacters: ['@', '.', '<'] },
            definitionProvider: true,
            documentSymbolProvider: true,
            hoverProvider: true,
            referencesProvider: true,
            signatureHelpProvider: { triggerCharacters: ['(', ','] },
            textDocumentSync: 2, // Incremental + full supported
          },
          serverInfo: { name: 'tsfg-lsp', version: '1.0.0' },
        },
      };
    }

    if (method === 'initialized' || method === 'textDocument/didSave') {
      return null;
    }

    if (method === 'textDocument/didOpen') {
      const { uri, text } = params.textDocument;
      const analysis = analyzeTsfgDocument(uri, text, null);
      this.documents.set(uri, { text, ...analysis });
      return {
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: { uri, diagnostics: analysis.diagnostics },
      };
    }

    if (method === 'textDocument/didChange') {
      const uri = params.textDocument.uri;
      const prev = this.documents.get(uri);
      const text = applyIncrementalChanges(prev?.text ?? '', params.contentChanges ?? []);
      const analysis = analyzeTsfgDocument(uri, text, prev?.symbols ?? null);
      this.documents.set(uri, { text, ...analysis });
      return {
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: { uri, diagnostics: analysis.diagnostics },
      };
    }

    if (method === 'textDocument/didClose') {
      this.documents.delete(params.textDocument.uri);
      return {
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: { uri: params.textDocument.uri, diagnostics: [] },
      };
    }

    if (method === 'textDocument/hover' || method === 'textDocument/definition') {
      const doc = this.documents.get(params.textDocument.uri);
      if (!doc) return { id, jsonrpc: '2.0', result: null };
      const lineText = doc.text.split(/\r?\n/)[params.position.line] ?? '';
      const word = extractWordAt(lineText, params.position.character);
      const sym = this._lookupSymbol(doc, word);
      if (!sym) return { id, jsonrpc: '2.0', result: null };

      if (method === 'textDocument/hover') {
        return {
          id,
          jsonrpc: '2.0',
          result: {
            contents: { kind: 'markdown', value: `\`\`\`ts\n${sym.detail}\n\`\`\`` },
          },
        };
      }
      return {
        id,
        jsonrpc: '2.0',
        result: {
          uri: sym.uri ?? params.textDocument.uri,
          range: {
            start: { line: sym.line, character: sym.col },
            end: { line: sym.line, character: sym.col + word.length },
          },
        },
      };
    }

    if (method === 'textDocument/completion') {
      const items = [...TSFG_COMPLETION_BUILTINS];
      const seen = new Set(items.map((x) => x.label));
      for (const doc of this.documents.values()) {
        for (const [name, sym] of doc.symbols.entries()) {
          if (!seen.has(name)) {
            seen.add(name);
            items.push({ label: name, kind: sym.lspKind === 5 ? 7 : 3, detail: sym.detail });
          }
        }
      }
      for (const [name, sym] of this.packageSymbols.entries()) {
        if (!seen.has(name)) {
          seen.add(name);
          items.push({ label: name, kind: sym.lspKind === 5 ? 7 : 3, detail: `${sym.detail} (from .tpkg)` });
        }
      }
      return { id, jsonrpc: '2.0', result: { isIncomplete: false, items } };
    }

    if (method === 'textDocument/documentSymbol') {
      const doc = this.documents.get(params.textDocument.uri);
      if (!doc) return { id, jsonrpc: '2.0', result: [] };
      const list = [...doc.symbols.values()].map((sym) => ({
        name: sym.name,
        detail: sym.detail,
        kind: sym.lspKind ?? 12,
        range: { start: { line: sym.line, character: sym.col }, end: { line: sym.line, character: sym.col + sym.name.length } },
        selectionRange: { start: { line: sym.line, character: sym.col }, end: { line: sym.line, character: sym.col + sym.name.length } },
      }));
      return { id, jsonrpc: '2.0', result: list };
    }

    if (method === 'textDocument/signatureHelp') {
      const doc = this.documents.get(params.textDocument.uri);
      if (!doc) return { id, jsonrpc: '2.0', result: null };
      const lineText = (doc.text.split(/\r?\n/)[params.position.line] ?? '').slice(0, params.position.character);
      const callMatch = lineText.match(/([A-Za-z_]\w*)\s*\(([^()]*)$/);
      if (!callMatch) return { id, jsonrpc: '2.0', result: null };
      const sym = this._lookupSymbol(doc, callMatch[1]);
      if (!sym) return { id, jsonrpc: '2.0', result: null };
      const activeParameter = callMatch[2].split(',').length - 1;
      return {
        id,
        jsonrpc: '2.0',
        result: {
          signatures: [{ label: sym.detail }],
          activeSignature: 0,
          activeParameter: Math.max(0, activeParameter),
        },
      };
    }

    if (method === 'textDocument/references') {
      const doc = this.documents.get(params.textDocument.uri);
      if (!doc) return { id, jsonrpc: '2.0', result: [] };
      const lineText = doc.text.split(/\r?\n/)[params.position.line] ?? '';
      const word = extractWordAt(lineText, params.position.character);
      if (!word) return { id, jsonrpc: '2.0', result: [] };
      const refs = [];
      const re = new RegExp(`\\b${word}\\b`, 'g');
      for (const [uri, d] of this.documents.entries()) {
        const ls = d.text.split(/\r?\n/);
        for (let li = 0; li < ls.length; li++) {
          for (const m of ls[li].matchAll(re)) {
            refs.push({
              uri,
              range: { start: { line: li, character: m.index }, end: { line: li, character: m.index + word.length } },
            });
          }
        }
      }
      return { id, jsonrpc: '2.0', result: refs };
    }

    if (method === 'shutdown') {
      this.shutdownRequested = true;
      return { id, jsonrpc: '2.0', result: null };
    }

    if (method === 'exit') {
      return null;
    }

    return {
      id,
      jsonrpc: '2.0',
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  }
}

function extractWordAt(line, col) {
  let s = col;
  let e = col;
  while (s > 0 && /\w/.test(line[s - 1])) s--;
  while (e < line.length && /\w/.test(line[e])) e++;
  return line.slice(s, e) || null;
}

/** Encode a JSON-RPC message using standard LSP Content-Length framing. */
export function encodeLspFrame(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}

/** Decode all complete LSP frames from a Buffer. */
export function decodeLspFrames(buf) {
  const messages = [];
  let offset = 0;
  while (offset < buf.length) {
    const hdrEnd = buf.indexOf('\r\n\r\n', offset);
    if (hdrEnd < 0) break;
    const hdr = buf.subarray(offset, hdrEnd).toString('ascii');
    const m = hdr.match(/Content-Length:\s*(\d+)/i);
    if (!m) break;
    const len = Number(m[1]);
    const bodyStart = hdrEnd + 4;
    if (bodyStart + len > buf.length) break;
    messages.push(JSON.parse(buf.subarray(bodyStart, bodyStart + len).toString('utf8')));
    offset = bodyStart + len;
  }
  return messages;
}

/** Run `tsfg-lsp` as a live Content-Length framed JSON-RPC 2.0 server over stdio. */
export function startLspStdioServer() {
  const server = new TsfgLspServer();
  let buf = Buffer.alloc(0);
  process.stdin.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (true) {
      const hdrEnd = buf.indexOf('\r\n\r\n');
      if (hdrEnd < 0) break;
      const m = buf.subarray(0, hdrEnd).toString('ascii').match(/Content-Length:\s*(\d+)/i);
      if (!m) break;
      const len = Number(m[1]);
      if (buf.length < hdrEnd + 4 + len) break;
      const msg = JSON.parse(buf.subarray(hdrEnd + 4, hdrEnd + 4 + len).toString('utf8'));
      buf = buf.subarray(hdrEnd + 4 + len);
      const reply = server.handleMessage(msg);
      if (reply) process.stdout.write(encodeLspFrame(reply));
      if (msg.method === 'exit') process.exit(server.shutdownRequested ? 0 : 1);
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startLspStdioServer();
}
