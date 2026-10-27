<!-- SPDX-License-Identifier: MIT -->

# Runtime responsibility area

This directory owns the Zig runtime and its product-facing execution boundary.
R00 defines the boundary but intentionally ships no runtime implementation
here.

Runtime interfaces consumed by the compiler or tooling must be versioned at an
approved contract seam; build orchestration remains under `eng/`.
