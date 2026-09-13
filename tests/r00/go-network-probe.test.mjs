// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
import { requireSocketPermissionDenial, requireGoDownloadPermissionDenial } from "../../eng/go-network-probe.mjs";

test("only explicit socket permission errors establish a denied observation", () => {
  assert.equal(requireSocketPermissionDenial({ code: "EACCES" }), "blocked");
  assert.equal(requireSocketPermissionDenial({ code: "EPERM" }), "blocked");
  for (const code of ["ECONNREFUSED", "ETIMEDOUT", "ENETUNREACH", undefined]) {
    assert.throws(() => requireSocketPermissionDenial({ code }), /inconclusive/);
  }
});

test("missing-module negative requires a failed Go dial to the exact controlled endpoint", () => {
  const denied = { status: 1, stdout: JSON.stringify({ Error: 'Get "http://127.0.0.1:32123/module": dial tcp 127.0.0.1:32123: connectex: An attempt was made to access a socket in a way forbidden by its access permissions.' }), stderr: "" };
  assert.equal(requireGoDownloadPermissionDenial(denied, 32123), "permission-denied");
  for (const result of [{ ...denied, status: 0 }, { ...denied, error: new Error("timeout") },
    { status: 1, stderr: "connection refused" }, { status: 1, stderr: "HTTP 403 permission denied" },
    { status: 1, stderr: "dial tcp 127.0.0.1:32123: connectex: connection refused; unrelated permission denied" }]) {
    assert.throws(() => requireGoDownloadPermissionDenial(result, 32123), /not proven/);
  }
  assert.throws(() => requireGoDownloadPermissionDenial(denied, 32124), /not proven/);
});
