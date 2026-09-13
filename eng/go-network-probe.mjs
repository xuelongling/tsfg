// SPDX-License-Identifier: MIT
// Observations are deliberately narrower than generic network failure.
export function requireSocketPermissionDenial(error) {
  if (["EACCES", "EPERM"].includes(error?.code)) return "blocked";
  throw new Error(`network denial inconclusive: ${error?.code ?? "no permission error"}`);
}

export function requireGoDownloadPermissionDenial(child, port) {
  const text = `${child.stdout ?? ""}\n${child.stderr ?? ""}`;
  const endpoint = `dial tcp 127.0.0.1:${port}: connectex:`;
  const denied = ["An attempt was made to access a socket in a way forbidden by its access permissions.",
    "permission denied", "Access is denied."]
    .some((message) => text.toLowerCase().includes(`${endpoint} ${message}`.toLowerCase()));
  if (child.error || child.status !== 1 || !text.includes(endpoint)
      || !denied) {
    throw new Error(`Go missing-module network denial not proven (${child.status}): ${child.error?.message ?? text}`);
  }
  return "permission-denied";
}
