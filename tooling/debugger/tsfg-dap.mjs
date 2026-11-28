// SPDX-License-Identifier: MIT
// Production Debug Adapter Protocol (DAP) Server for tsfg (Windows x64 VM + AOT PDB).
// Implements Content-Length framed JSON-RPC over stdio (and programmatic `handleRequest`)
// driving live `tsfg-r05-vm.exe` breakpoints, stack frames, and register/local inspection.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { UnifiedDebugSession } from './r12-inspector-debugger.mjs';

export class TsfgDapServer {
  constructor() {
    this.seq = 1;
    this.breakpointsByFile = new Map(); // file -> number[]
    this.session = new UnifiedDebugSession();
    this.lastRun = null;
    this.pausedIndex = 0;
    this.outbound = [];
  }

  _event(event, body = {}) {
    return { seq: this.seq++, type: 'event', event, body };
  }

  _response(req, body = {}, success = true, message = undefined) {
    const res = {
      seq: this.seq++,
      type: 'response',
      request_seq: req.seq,
      success,
      command: req.command,
      body,
    };
    if (message) res.message = message;
    return res;
  }

  async handleMessage(req) {
    const msgs = [];
    const cmd = req.command;
    const args = req.arguments ?? {};

    if (cmd === 'initialize') {
      msgs.push(
        this._response(req, {
          supportsConfigurationDoneRequest: true,
          supportsEvaluateForHovers: true,
          supportsStepBack: false,
          supportsTerminateRequest: true,
        }),
      );
      msgs.push(this._event('initialized'));
      return msgs;
    }

    if (cmd === 'setBreakpoints') {
      const file = args.source?.path ?? '';
      const lines = (args.breakpoints ?? []).map((b) => Number(b.line)).filter((n) => n > 0);
      this.breakpointsByFile.set(file, lines);
      for (const l of lines) this.session.setBreakpoint(file, l);
      msgs.push(
        this._response(req, {
          breakpoints: lines.map((line, i) => ({ id: i + 1, verified: true, line })),
        }),
      );
      return msgs;
    }

    if (cmd === 'configurationDone') {
      msgs.push(this._response(req));
      return msgs;
    }

    if (cmd === 'launch') {
      const program = args.program;
      if (!program) {
        msgs.push(this._response(req, {}, false, 'tsfg-dap: launch requires `program` (.ts file path)'));
        return msgs;
      }
      const sourceText = await readFile(program, 'utf8');
      const bpLines = this.breakpointsByFile.get(program) ?? [];
      const live = await this.session.runLiveVmSession(program, {
        isFile: true,
        sourceText,
        entry: args.entry ?? 'main',
        args: args.args ?? [],
        breakpointLine: bpLines.length > 0 ? bpLines[0] : undefined,
        breakpointPc: bpLines.length === 0 ? (args.stopOnEntry ? 0 : undefined) : undefined,
        debugStep: Boolean(args.debugStep),
      });
      this.lastRun = live;
      this.pausedIndex = 0;
      msgs.push(this._response(req));
      if (live.pauses.length > 0) {
        msgs.push(this._event('stopped', { reason: bpLines.length > 0 ? 'breakpoint' : 'entry', threadId: 1, allThreadsStopped: true }));
      } else {
        msgs.push(this._event('terminated'));
      }
      return msgs;
    }

    if (cmd === 'threads') {
      msgs.push(this._response(req, { threads: [{ id: 1, name: 'tsfg-vm-main' }] }));
      return msgs;
    }

    if (cmd === 'stackTrace') {
      const pause = this.lastRun?.pauses[this.pausedIndex];
      const frames = pause
        ? [
            {
              id: 1,
              name: pause.functionName,
              source: { name: pause.file, path: pause.file },
              line: pause.line,
              column: pause.column ?? 1,
            },
          ]
        : [];
      msgs.push(this._response(req, { stackFrames: frames, totalFrames: frames.length }));
      return msgs;
    }

    if (cmd === 'scopes') {
      msgs.push(
        this._response(req, {
          scopes: [{ name: 'Locals (Registers)', variablesReference: 1, expensive: false }],
        }),
      );
      return msgs;
    }

    if (cmd === 'variables') {
      const pause = this.lastRun?.pauses[this.pausedIndex];
      const vars = pause
        ? Object.entries(pause.locals).map(([name, val]) => ({
            name,
            value: String(val),
            type: 'i32',
            variablesReference: 0,
          }))
        : [];
      msgs.push(this._response(req, { variables: vars }));
      return msgs;
    }

    if (cmd === 'next' || cmd === 'continue') {
      msgs.push(this._response(req, { allThreadsContinued: true }));
      if (this.lastRun && this.pausedIndex + 1 < this.lastRun.pauses.length) {
        this.pausedIndex += 1;
        msgs.push(this._event('stopped', { reason: cmd === 'next' ? 'step' : 'breakpoint', threadId: 1 }));
      } else {
        msgs.push(this._event('terminated'));
      }
      return msgs;
    }

    if (cmd === 'disconnect' || cmd === 'terminate') {
      msgs.push(this._response(req));
      return msgs;
    }

    msgs.push(this._response(req, {}, false, `tsfg-dap: unsupported command '${cmd}'`));
    return msgs;
  }
}

export function encodeDapFrame(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}

export function startDapStdioServer() {
  const server = new TsfgDapServer();
  let buf = Buffer.alloc(0);
  process.stdin.on('data', async (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (true) {
      const hdrEnd = buf.indexOf('\r\n\r\n');
      if (hdrEnd < 0) break;
      const m = buf.subarray(0, hdrEnd).toString('ascii').match(/Content-Length:\s*(\d+)/i);
      if (!m) break;
      const len = Number(m[1]);
      if (buf.length < hdrEnd + 4 + len) break;
      const req = JSON.parse(buf.subarray(hdrEnd + 4, hdrEnd + 4 + len).toString('utf8'));
      buf = buf.subarray(hdrEnd + 4 + len);
      const responses = await server.handleMessage(req);
      for (const r of responses) process.stdout.write(encodeDapFrame(r));
      if (req.command === 'disconnect') process.exit(0);
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startDapStdioServer();
}
