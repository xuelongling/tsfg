<!-- SPDX-License-Identifier: MIT -->

# `tsfg.r05-bytecode` (`TSFGR05B`) Verified Bytecode Binary Contract

`tsfg.r05-bytecode` defines the binary register-VM module format (`TSFGR05B`, format versions 1 & 2)
emitted by `compiler/r05-bytecode-lower.mjs` and verified before execution by
`runtime/r05-bytecode.zig:verifyAndPredecode`.

## Binary Framing

- Bytes `0..8`: ASCII magic `TSFGR05B`
- Bytes `8..12`: Little-endian `u32` format version (`1` or `2`; v2 includes lossless UTF-16 string constant pool)
- Bytes `12..16`: Little-endian `u32` total byte size (exact match enforced, trailing bytes rejected)
- Bytes `16..48`: 32-byte SHA-256 digest of payload bytes `[48..totalBytes)`
- Bytes `48..`: Module identity (`module_id`, `abi_hash`, `static_schema_hash`, `code_version`),
  globals/capabilities/f64/UTF-16 string pools, and verified functions (entry fuel at `pc = 0`,
  loop back-edge fuel verification, valid jump targets, exception handler table, 20-byte fixed instructions
  with UTF-16 source spans).
