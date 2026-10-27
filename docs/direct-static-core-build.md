<!-- SPDX-License-Identifier: MIT -->
# Direct-source static Core factory

The existing MLIR factory now has an explicit `--core-command-role static` responsibility. It builds the complete current [source manifest](../compiler/core-ir/sources.json), including both formal0.10 and the private Common Program selector, from the qualified upstream source tree. It does not consume an SDK compiler, prebuilt SDK libraries or a replacement parser.

```text
node eng/tsfg-build.mjs build --dev --source-target mlir-core --core-command-role static --target windows-x86_64-msvc --profile debug --out E:/owned/output --report E:/owned/report.json
```

The explicit static role participates in the build identity and selects `tsfg-core-static`. Default native retains `tsfg-core-ir`, its X86 configuration and its existing option/manifest shape. Both roles use exactly the same dev source manifest; no compiler implementation or public language contract changes.

Before static source bodies are copied, the factory chooses only the existing pinned legal registration and original notices. X86/backend implementation paths are excluded from that selection. Original raw bytes, independently registered staged notice bytes and compiler-consumption identity remain distinct. Missing, changed, redirected or undeclared sources fail at their owning boundary.

Static configuration selects no LLVM target backend. Planned and final Ninja dependencies, CMake evaluation origins, source identities and link roles are checked before their bodies are read. Generic LLVMCore/Support/TargetParser and the required generator's exact LLVMCodeGenTypes archive retain their actual roles; filenames alone grant no native permission.

Product staging and the consumer source-freshness gate use `compiler/core-ir/sources.json`, with the source directory, CMake and freshness helper themselves bound by the declared identity. All source and policy identities pass before copying; every staged copy is rechecked.

`--mlir-build-phase plan` performs the real configuration/dependency qualification and stops before the target build. Its result is explicitly unbuilt plan evidence. It is distinct from the pure Node role/staging tests, which never run CMake, LLVM or a compiler.

Keep `--out` short on Windows: a generated resource output failed at 265 path characters and succeeded at 228 after shortening this supported output option.

A new source factory artifact requires a fresh qualified build of the current identity. The earlier ACTUAL09 result establishes its original source-only closure; it does not automatically qualify the current dev artifact. Static output confers no VM, Runtime, ResourceProof or native execution qualification.
