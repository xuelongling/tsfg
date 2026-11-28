// SPDX-License-Identifier: MIT
// VS Code Extension entrypoint connecting VS Code to `tsfgc lsp` (LSP) and `tsfgc dap` (DAP).
const path = require('node:path');
const { spawn } = require('node:child_process');

/** @param {import('vscode').ExtensionContext} context */
function activate(context) {
  const vscode = require('vscode');
  const config = vscode.workspace.getConfiguration('tsfg');
  const tsfgc = config.get('tsfgcPath') || path.resolve(__dirname, '..', '..', 'bin', 'tsfgc.cmd');

  // Register Debug Adapter Factory launching `tsfgc dap`
  const factory = {
    createDebugAdapterDescriptor() {
      return new vscode.DebugAdapterExecutable(tsfgc, ['dap']);
    },
  };
  context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('tsfg', factory));

  // Register command to launch `tsfgc lsp` diagnostics session
  context.subscriptions.push(
    vscode.commands.registerCommand('tsfg.restartLanguageServer', () => {
      const child = spawn(tsfgc, ['lsp'], { stdio: 'pipe', windowsHide: true });
      child.unref();
      vscode.window.showInformationMessage('tsfg-lsp started');
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
