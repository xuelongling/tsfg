// SPDX-License-Identifier: MIT
// R12 `tsfg-lsp`: JSON-RPC 2.0 Language Server merging TypeScript-style syntax/type diagnostics
// with tsfg semantic, kernel (`@component`/`@system`/`@gpu_kernel`), ABI, and hot-reload diagnostics.
// Supports both programmatic RPC dispatch and Content-Length framed LSP stdio streams.

export function analyzeTsfgDocument(uri, text, prevSymbols = null) {
  const diagnostics = [];
  const symbols = new Map(); // name -> { kind, line, col, detail }
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

    // Track decorators (`@component`, `@value`, `@abi`, `@system`, `@gpu_kernel`)
    const dec = line.match(/@(component|value|abi|system|gpu_kernel)\b/);
    if (dec) {
      activeDecorator = dec[1];
    }

    // Track class / function declarations for hover & go-to-definition
    const classMatch = line.match(/\b(?:export\s+)?class\s+([A-Za-z_]\w*)/);
    if (classMatch) {
      const name = classMatch[1];
      const col = line.indexOf(name);
      symbols.set(name, {
        kind: activeDecorator ? `@${activeDecorator} class` : 'class',
        line: i,
        col,
        detail: `${activeDecorator ? `@${activeDecorator} ` : ''}class ${name}`,
      });
      inBlockDecorator = activeDecorator;
      activeDeclName = name;
      activeDecorator = null;
    }

    const fnMatch = line.match(/\b(?:export\s+)?function\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/);
    if (fnMatch) {
      const name = fnMatch[1];
      const params = fnMatch[2];
      const col = line.indexOf(name);
      symbols.set(name, {
        kind: activeDecorator ? `@${activeDecorator} function` : 'function',
        line: i,
        col,
        detail: `${activeDecorator ? `@${activeDecorator} ` : ''}function ${name}(${params})`,
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
    const anyIdx = line.search(/:\s*any\b|\bas\s+any\b/);
    if (anyIdx >= 0) {
      pushDiag(i, anyIdx, anyIdx + 5, 'r02b-forbid-any', 1, 'tsfg forbids `any`; specify a static fixed type');
    }
    const evalIdx = line.search(/\beval\s*\(|new\s+Function\s*\(/);
    if (evalIdx >= 0) {
      pushDiag(i, evalIdx, evalIdx + 4, 'r02b-forbid-eval', 1, 'tsfg forbids dynamic eval/Function');
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

    // Update brace depth to track scope exit
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

  // Hot-reload compatibility warning if a previously declared `@component` / `@abi` changed fields
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

export class TsfgLspServer {
  constructor() {
    this.documents = new Map(); // uri -> { text, diagnostics, symbols }
    this.initialized = false;
    this.shutdownRequested = false;
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
            definitionProvider: true,
            hoverProvider: true,
            textDocumentSync: 1,
          },
          serverInfo: { name: 'tsfg-lsp', version: '1.0.0' },
        },
      };
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
      const text = params.contentChanges[params.contentChanges.length - 1].text;
      const analysis = analyzeTsfgDocument(uri, text, prev?.symbols ?? null);
      this.documents.set(uri, { text, ...analysis });
      return {
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: { uri, diagnostics: analysis.diagnostics },
      };
    }

    if (method === 'textDocument/hover' || method === 'textDocument/definition') {
      const doc = this.documents.get(params.textDocument.uri);
      if (!doc) return { id, jsonrpc: '2.0', result: null };
      const lineText = doc.text.split(/\r?\n/)[params.position.line] ?? '';
      const word = extractWordAt(lineText, params.position.character);
      const sym = word ? doc.symbols.get(word) : null;
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
          uri: params.textDocument.uri,
          range: {
            start: { line: sym.line, character: sym.col },
            end: { line: sym.line, character: sym.col + word.length },
          },
        },
      };
    }

    if (method === 'shutdown') {
      this.shutdownRequested = true;
      return { id, jsonrpc: '2.0', result: null };
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
