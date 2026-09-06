// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

test("toolchain lock content-locks both debug closures and bootstrap tools", async () => {
  const lockBytes = await readFile(path.join(repositoryRoot, "eng", "toolchains.lock.json"), "utf8");
  const lock = JSON.parse(lockBytes);
  assert.equal(lock.schemaVersion, "1");
  assert.equal(lock.unpackedTreeAlgorithm, "tsfg-tree-sha256-v1");
  assert.deepEqual(lock.dependencyLocks, [
    {
      projectId: "tsfg",
      path: "pnpm-lock.yaml",
      sha256: "sha256:e110b44300bc75e28489500b7d2165b27414e2c6283853d7e4220b5fc27e06db",
    },
  ]);
  assert.equal(
    createHash("sha256")
      .update(await readFile(path.join(repositoryRoot, "pnpm-lock.yaml")))
      .digest("hex"),
    lock.dependencyLocks[0].sha256.slice("sha256:".length),
  );
  assert.deepEqual(lock.targets, {
    "linux-x86_64-gnu": {
      tools: ["archive-extractor", "cmake", "debian-sysroot", "llvm", "ninja", "node", "pnpm", "zig"],
    },
    "windows-x86_64-msvc": {
      tools: ["archive-extractor-windows", "cmake", "llvm", "msvc-tools", "ninja", "node", "pnpm", "windows-sdk", "zig"],
    },
  });
  assert.deepEqual(Object.keys(lock.tools).sort(), [
    "archive-extractor",
    "archive-extractor-windows",
    "cmake",
    "debian-sysroot",
    "llvm",
    "msvc-tools",
    "ninja",
    "node",
    "pnpm",
    "windows-sdk",
    "zig",
  ]);
  assert.equal(lock.tools.cmake.version, "4.4.3");
  assert.equal(lock.tools["archive-extractor-windows"].version, "26.02");
  assert.deepEqual(lock.tools["archive-extractor-windows"].artifacts[0], {
    archiveFormat: "7zip-bootstrap",
    archiveSha256: "sha256:6745fa76dc2ea031596d8678f6f6b99c3c1b435b4164a63485adbbc7b8d82ef0",
    bootstrap: {
      archiveSha256: "sha256:56b8cc9f4971cef253644fafe54063ed7fdca551d4dee0f8c6baa81b855acd72",
      byteSize: "602112",
      url: "https://github.com/ip7z/7zip/releases/download/26.02/7zr.exe",
    },
    byteSize: "1657896",
    extractorKind: "7zip",
    installPath: "7z.exe",
    platform: "windows-x86_64-msvc",
    unpackedTreeSha256: "sha256:962f54dcf4c2679882d5408de12725373c29c921c1712439f71f337ef8881a7b",
    url: "https://www.7-zip.org/a/7z2602-x64.exe",
    verification: {
      kind: "authenticode+github-release-asset-digest",
      signer: "Igor Pavlov",
      verificationUrl: "https://www.7-zip.org/download.html",
    },
  });
  assert.equal(lock.tools["debian-sysroot"].version, "12.15");
  assert.equal(lock.tools.llvm.version, "22.1.6");
  assert.equal(lock.tools.ninja.version, "1.13.2");
  assert.equal(lock.tools.node.version, "24.20.0");
  assert.equal(lock.tools.pnpm.version, "11.25.0");
  assert.equal(lock.tools.zig.version, "0.16.0");
  assert.equal(lock.tools["msvc-tools"].version, "14.44.35207");
  assert.equal(lock.tools["msvc-tools"].buildToolsVersion, "17.14.35");
  assert.equal(lock.tools["windows-sdk"].version, "10.0.26100.9169");
  assert.equal(lock.tools["windows-sdk"].abiVersion, "10.0.26100.0");
  assert.deepEqual(
    lock.tools["debian-sysroot"].artifacts[0].archives.map(({ id }) => id),
    [
      "gcc-12-base",
      "libc6",
      "libc6-dev",
      "libgcc-s1",
      "libicu72",
      "liblzma5",
      "libstdc++6",
      "libxml2",
      "linux-libc-dev",
      "zlib1g",
    ],
  );
  assert.deepEqual(lock.tools.llvm.artifacts[0].executables, {
    ar: "bin/llvm-ar",
    clang: "bin/clang",
    clangxx: "bin/clang++",
    lld: "bin/ld.lld",
    objcopy: "bin/llvm-objcopy",
    ranlib: "bin/llvm-ranlib",
  });
  const windowsLlvm = lock.tools.llvm.artifacts.find(
    ({ platform }) => platform === "windows-x86_64-msvc",
  );
  assert.deepEqual(windowsLlvm.executables, {
    ar: "bin/llvm-ar.exe",
    clang: "bin/clang.exe",
    clangcl: "bin/clang-cl.exe",
    lld: "bin/lld-link.exe",
    objcopy: "bin/llvm-objcopy.exe",
    pdbutil: "bin/llvm-pdbutil.exe",
    ranlib: "bin/llvm-ranlib.exe",
  });
  assert.deepEqual(lock.tools["msvc-tools"].artifacts[0].executables, {
    cl: "VC/Tools/MSVC/14.44.35207/bin/Hostx64/x64/cl.exe",
    link: "VC/Tools/MSVC/14.44.35207/bin/Hostx64/x64/link.exe",
  });
  assert.deepEqual(lock.tools["msvc-tools"].artifacts[0].archives.map(({ id }) => id), [
    "crt-headers",
    "crt-libs-x64",
    "host-x64-target-x64",
    "host-x64-target-x64-res-enu",
  ]);
  assert.deepEqual(lock.tools["windows-sdk"].artifacts[0].executables, {
    mt: "c/bin/10.0.26100.0/x64/mt.exe",
    rc: "c/bin/10.0.26100.0/x64/rc.exe",
  });
  for (const tool of Object.values(lock.tools)) {
    assert.notEqual(tool.license, "");
    assert.notEqual(tool.signature.kind, "");
    assert.notEqual(tool.signature.signer, "");
    assert.ok(tool.artifacts.length > 0);
    for (const artifact of tool.artifacts) {
      assert.notEqual(artifact.verification?.kind, "");
      assert.notEqual(artifact.verification?.signer, "");
      assert.match(artifact.verification?.verificationUrl ?? "", /^https:\/\//);
      if (artifact.archiveFormat.endsWith("-set")) {
        assert.ok(artifact.archives.length > 0);
        for (const member of artifact.archives) {
          assert.match(member.url, /^https:\/\//);
          assert.match(member.byteSize, /^[1-9][0-9]*$/);
          assert.match(member.archiveSha256, /^sha256:[0-9a-f]{64}$/);
          assert.notEqual(member.license, "");
        }
      } else {
        assert.match(artifact.url, /^https:\/\//);
      }
      assert.match(artifact.byteSize, /^[1-9][0-9]*$/);
      assert.match(artifact.archiveSha256, /^sha256:[0-9a-f]{64}$/);
      assert.match(artifact.unpackedTreeSha256, /^sha256:[0-9a-f]{64}$/);
    }
  }

  assert.deepEqual(
    lock.tools.node.artifacts.map(({ platform, byteSize, archiveSha256, unpackedTreeSha256 }) => ({
      platform,
      byteSize,
      archiveSha256,
      unpackedTreeSha256,
    })),
    [
      {
        platform: "linux-x86_64-gnu",
        byteSize: "58006679",
        archiveSha256: "sha256:855d581f8a4eb1a8117e3426de25fe02770592febcfb31369aee1ffbfee9e8ec",
        unpackedTreeSha256: "sha256:bc82944c0f67b447ef59239765344b4a1be75aa2752a7a958693c8ba6e118427",
      },
      {
        platform: "windows-x86_64-msvc",
        byteSize: "37539751",
        archiveSha256: "sha256:6cac9ffbca8f6a47091e4b5c772e0606049c3871cb67d900c0cedde630e545ba",
        unpackedTreeSha256: "sha256:d3c8d5a3cd0b70b8ca9184537edd6d221b3dea6b006de0e348308f102a7822e9",
      },
    ],
  );
  assert.deepEqual(
    lock.tools.pnpm.artifacts.map(({ platform, byteSize, archiveSha256, unpackedTreeSha256 }) => ({
      platform,
      byteSize,
      archiveSha256,
      unpackedTreeSha256,
    })),
    [
      {
        platform: "linux-x86_64-gnu",
        byteSize: "51293579",
        archiveSha256: "sha256:11caeed8b581d460638f836f10f6ead19cbf08d774a5b8e502628b20ebf3ac43",
        unpackedTreeSha256: "sha256:286c1dc4795dd9e1344075a0587eef58d57866ccfd6588e9679363e0727cb178",
      },
      {
        platform: "windows-x86_64-msvc",
        byteSize: "41121270",
        archiveSha256: "sha256:2d0203af85fc6fbb40f786a2671f175e9119a7c6dfcc4f30b1fa17e0f072c301",
        unpackedTreeSha256: "sha256:ec42c6f14b4d5b21f98c61ec41ff1019d1e2c5c70867cc1417f0d740b7d584af",
      },
    ],
  );
  assert.deepEqual(
    lock.tools.node.artifacts.map(({ platform, executableSha256 }) => ({
      platform,
      executableSha256,
    })),
    [
      {
        platform: "linux-x86_64-gnu",
        executableSha256: "sha256:89af8424dd53e560b1933f87ba650d8bf57c83ca5a04600eefb31f416aabbae7",
      },
      {
        platform: "windows-x86_64-msvc",
        executableSha256: "sha256:5c976096e04e5c2c1f091938926234cc9fbebfe9787ddd149351b3b0ecc707b5",
      },
    ],
  );

  const closureIdentities = {};
  for (const target of Object.keys(lock.targets).sort()) {
    const dependencyLocks = [...lock.dependencyLocks].sort((left, right) =>
      left.projectId.localeCompare(right.projectId) || left.path.localeCompare(right.path));
    const tools = lock.targets[target].tools.map((id) => {
      const tool = lock.tools[id];
      const artifact = tool.artifacts.find(({ platform }) => platform === target);
      return {
        id,
        version: tool.version,
        platform: artifact.platform,
        archiveSha256: artifact.archiveSha256,
        unpackedTreeSha256: artifact.unpackedTreeSha256,
      };
    });
    closureIdentities[target] = createHash("sha256")
      .update(canonicalize({ dependencyLocks, schemaVersion: lock.schemaVersion, target, tools }))
      .digest("hex");
  }
  for (const [launcher, target] of [["tsfg-build", "linux-x86_64-gnu"], ["tsfg-build.cmd", "windows-x86_64-msvc"]]) {
    const nodeArtifact = lock.tools.node.artifacts.find(({ platform }) => platform === target);
    const launcherBytes = await readFile(path.join(repositoryRoot, "eng", launcher), "utf8");
    assert.match(
      launcherBytes,
      new RegExp(closureIdentities[target]),
    );
    assert.match(
      launcherBytes,
      new RegExp(nodeArtifact.executableSha256.slice("sha256:".length)),
    );
  }
  assert.doesNotMatch(
    await readFile(path.join(repositoryRoot, "eng", "tsfg-build.mjs"), "utf8"),
    /execFileSync\(["']tar["']/,
    "prefetch must not fall back to a system tar executable",
  );
  const linuxLauncher = await readFile(
    path.join(repositoryRoot, "eng", "tsfg-build"),
    "utf8",
  );
  const environmentReset = linuxLauncher.indexOf(
    "unset NODE_OPTIONS NODE_PATH NODE_REPL_EXTERNAL_MODULE NODE_EXTRA_CA_CERTS OPENSSL_CONF",
  );
  const lockedNodeExecution = linuxLauncher.lastIndexOf("exec /proc/self/fd/9");
  assert.ok(environmentReset >= 0, "Linux launcher must clear Node injection variables");
  assert.ok(
    environmentReset < lockedNodeExecution,
    "Node injection variables must be cleared before the locked Node executable starts",
  );
  assert.match(linuxLauncher, /TSFG_BOOTSTRAP_NODE/);
  assert.match(linuxLauncher, /TSFG_BOOTSTRAP_NODE_SHA256/);
  assert.doesNotMatch(
    linuxLauncher,
    /exec node /,
    "Linux prefetch must not select its bootstrap Node from PATH",
  );
});
