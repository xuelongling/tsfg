<!-- SPDX-License-Identifier: MIT -->

# tsfg VS Code Extension

Connects Visual Studio Code to the Windows x64 `tsfg` toolchain:

- **Language Server (`tsfg-lsp`)**: Launched via `tsfgc lsp` over stdio JSON-RPC 2.0 (`Content-Length` framed). Provides merged TypeScript + `tsfg` diagnostics (`@value`, `@component`, `@system`, `@gpu_kernel`, `@abi`, hot-reload compatibility), hover, go-to-definition (including precompiled `.tpkg` declarations), completion, signature help, document symbols, and references.
- **Debugger (`tsfg-dap`)**: Launched via `tsfgc dap` over stdio Debug Adapter Protocol. Drives live `tsfg-r05-vm.exe` breakpoints, stack traces, and register inspection, alongside Windows x64 `.pdb` AOT builds.
