// SPDX-License-Identifier: MIT
// The normal factory supplies these fixed production controls, never request
// fields. This module owns bootstrap selection, admission and one-shot state.
export async function prepareVmBootstrapWithControls(request, controls) {
  const {ConfigurationError,VmBuildError,isGoDestinationOnE,validateSmokeOptions,verifyRuntimeClosure,
    windowsToolchain,inspectProductWorkspace,executeVmTarget,canonicalize,digest,createBuildIdentity}=controls;
  const fields = ["lockPath", "cachePath", "productRoot", "output", "unqualifiedHostCounterReceipt", "currentSourceCounter"];
  if (!request || typeof request !== "object" || Array.isArray(request)
      || Object.keys(request).some(key => !fields.includes(key))) {
    throw new ConfigurationError("unsupported VM bootstrap field");
  }
  const { lockPath, cachePath, productRoot, output, unqualifiedHostCounterReceipt: receipt } = request;
  const currentSourceCounter = Object.hasOwn(request, "currentSourceCounter") ? request.currentSourceCounter : false;
  if (Object.hasOwn(request, "currentSourceCounter") && typeof currentSourceCounter !== "boolean"
      || currentSourceCounter && Object.hasOwn(request, "unqualifiedHostCounterReceipt"))
    throw new ConfigurationError("VM bootstrap counter selection must be current-source true or one independent cold receipt");
  if (!currentSourceCounter && (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
      || Object.keys(receipt).length !== 2
      || !Object.hasOwn(receipt, "bundlePath") || !Object.hasOwn(receipt, "expectedBundleSHA")
      || typeof receipt.expectedBundleSHA !== "string"
      || !/^sha256:[0-9a-f]{64}$/.test(receipt.expectedBundleSHA))) {
    throw new ConfigurationError("VM bootstrap requires an independent cold bundle digest");
  }
  const destinations = [lockPath, cachePath, productRoot, output, ...(currentSourceCounter ? [] : [receipt.bundlePath])];
  if (destinations.some(destination => typeof destination !== "string"
      || !/^E:[\\/]/i.test(destination) || destination.slice(2).includes(":"))) {
    throw new ConfigurationError("VM bootstrap requires absolute E: paths");
  }
  for (const destination of destinations) {
    if (!await isGoDestinationOnE(destination)) {
      throw new ConfigurationError("VM bootstrap requires ordinary absolute E: paths");
    }
  }
  const coldReceipt = currentSourceCounter ? undefined : Object.freeze({ bundlePath: receipt.bundlePath, expectedBundleSHA: receipt.expectedBundleSHA });
  const options = new Map([
    ["--source-target", "tsfg-vm"], ["--target", "windows-x86_64-msvc"],
    ["--profile", "debug"], ["--out", output], ["--workspace", productRoot], ["--dev", ""],
  ]);
  validateSmokeOptions(options, "build");
  const runtime = await verifyRuntimeClosure(lockPath, cachePath, "windows-x86_64-msvc", { nativeControls: false });
  const tools = windowsToolchain(runtime);
  const workspaceState = inspectProductWorkspace(options, true, "build");
  let spent = false;
  return Object.freeze({
    qualification: "unqualified Runtime bootstrap only",
    async execute(beforeBuild) {
      if (spent) throw new VmBuildError("VM bootstrap execution already consumed", "vm-bootstrap-spent");
      spent = true;
      if (typeof beforeBuild !== "function")
        throw new VmBuildError("VM bootstrap requires a fresh pre-build admission hook", "vm-bootstrap-admission");
      const current = await verifyRuntimeClosure(lockPath, runtime.cachePath,
        "windows-x86_64-msvc", { nativeControls: false });
      if (current.lockDigest !== runtime.lockDigest)
        throw new VmBuildError("Tool closure changed before VM bootstrap", "vm-tool-integrity");
      await beforeBuild();
      return executeVmTarget({ options, runtime, tools, productRoot: workspaceState.root, workspaceState,
        serialize: canonicalize, sha256: digest, unqualifiedHostCounterReceipt: coldReceipt, currentSourceCounter,
        createIdentity: (selectedRuntime, root) => createBuildIdentity(selectedRuntime,
          "windows-x86_64-msvc", "debug", root,
          { sourceTarget: "tsfg-vm", simdDispatch: "runtime-detected" }),
        verifyTools: async () => {
          const current = await verifyRuntimeClosure(lockPath, runtime.cachePath,
            "windows-x86_64-msvc", { nativeControls: false });
          if (current.lockDigest !== runtime.lockDigest)
            throw new VmBuildError("Tool closure changed during VM bootstrap", "vm-tool-integrity");
        },
        normalize: async () => {
          throw new VmBuildError("Unqualified bootstrap cannot publish a normalized VM", "vm-host-certificate");
        },
      });
    },
  });
}
