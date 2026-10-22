// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { invoke } from "./build-entry-invocation.mjs";
import { startArtifactServer, fixtureDigest, fixtureTreeDigest } from "./build-entry-fixtures.mjs";
import { verifyDevelopmentIsolation } from "./build-entry-native-development.mjs";
import { verifyDeclaredPoliciesAndMissingTools } from "./build-entry-native-policy.mjs";
import { verifyCleanBuildIdentity } from "./build-entry-native-identity.mjs";
import { verifyReleaseAndRuntimePackage } from "./build-entry-native-release.mjs";
import { verifyIndependentPackages } from "./build-entry-native-package.mjs";
import { verifyPublicationReplacements } from "./build-entry-native-publication.mjs";
import { verifyNativeFailureCategories } from "./build-entry-native-failures.mjs";

test("build and test run the private C++ and Zig smoke programs through locked tools", async (context) => {
  const sandbox = await mkdtemp(path.join(tmpdir(), "tsfg-linux-cpp-build-"));
  const cachePath = path.join(sandbox, "cache");
  const lockPath = path.join(sandbox, "toolchains.lock.json");
  const isWindows = process.platform === "win32";
  const publicationHelper = isWindows && process.env.TSFG_WINDOWS_PUBLICATION_TEST_HELPER
    ? await readFile(process.env.TSFG_WINDOWS_PUBLICATION_TEST_HELPER) : undefined;
  const cmake = Buffer.from(isWindows
    ? "@echo off\r\n%SystemRoot%\\System32\\findstr.exe /c:\"TSFG_TEST_REQUIRE_UNDECLARED\" \"%~2\\CMakeLists.txt\" >nul\r\nif not errorlevel 1 if not exist \"%~2\\undeclared.cpp\" (\r\n  >&2 echo Permission denied: tests/r00/smoke/cpp/undeclared.cpp\r\n  exit /b 124\r\n)\r\nset build_dir=%~4\r\nif not \"%build_dir:compile-fail=%\"==\"%build_dir%\" (\r\n  >&2 echo native dependency not found\r\n  exit /b 9\r\n)\r\nexit /b 0\r\n"
    : "#!/bin/sh\nwhile IFS= read -r line; do\n  case \"$line\" in\n    '# TSFG_TEST_REQUIRE_UNDECLARED '*)\n      undeclared=${line#* }\n      undeclared=${undeclared#* }\n      if IFS= read -r value < \"$undeclared\"; then\n        printf '%s\\n' 'sandbox allowed undeclared input' >&2\n        exit 18\n      fi\n      printf '%s\\n' 'ignored failed undeclared read' >&2\n      ;;\n    '# TSFG_TEST_MUTATE_DECLARED')\n      if printf '%s\\n' mutation >> \"$2/CMakeLists.txt\"; then\n        printf '%s\\n' 'sandbox allowed declared input mutation' >&2\n        exit 18\n      fi\n      printf '%s\\n' 'ignored failed source write' >&2\n      ;;\n  esac\ndone < \"$2/CMakeLists.txt\"\ncase \"$4\" in *compile-fail*) printf '%s\\n' 'native dependency not found' >&2; exit 9 ;; esac\nexit 0\n");
  const ninja = Buffer.from(isWindows
    ? "@echo off\r\n>\"%~2\\tsfg-r00-cpp-smoke\" echo fixture cpp output\r\nif not exist \"%~2\\..\\zig-install\\bin\" mkdir \"%~2\\..\\zig-install\\bin\"\r\n>\"%~2\\..\\zig-install\\bin\\tsfg-r00-zig-smoke\" echo fixture zig output\r\nexit /b 0\r\n"
    : `#!/bin/sh
{
  echo '#!/bin/sh'
  echo 'if [ "$1" = --cpu-fixture=x86-64-v2 ]; then'
  echo '  printf "tsfg-r00-cpp-smoke: baseline fallback ok\\n"'
  echo 'else'
  echo '  printf "tsfg-r00-cpp-smoke: ok\\n"'
  echo 'fi'
} > "$2/tsfg-r00-cpp-smoke"
`);
  const zig = Buffer.from(isWindows
    ? "@echo off\r\nexit /b 0\r\n"
    : `#!/bin/sh
if [ "$1" = cc ]; then
  previous=
  while [ "$#" -gt 0 ]; do
    if [ "$1" = -o ]; then
      exec /usr/bin/cc -O2 "$previous" -o "$2"
    fi
    previous=$1
    shift
  done
  exit 1
fi
while [ "$#" -gt 0 ]; do
  if [ "$1" = --prefix ]; then
    {
      echo '#!/bin/sh'
      echo 'printf "tsfg-r00-zig-smoke: ok\\n" >&2'
    } > "$2/bin/tsfg-r00-zig-smoke"
    /bin/chmod +x "$2/bin/tsfg-r00-zig-smoke"
    exit 0
  fi
  shift
done
exit 1
`);
  const inert = Buffer.from(isWindows ? "@echo off\r\nexit /b 0\r\n" : "#!/bin/sh\nexit 0\n");
  let lockedShell = inert;
  if (!isWindows) {
    try {
      lockedShell = Buffer.from(await readFile("/usr/bin/busybox"));
      await stat("/usr/bin/cc");
      const routes = await readFile("/proc/net/route", "utf8");
      if (routes.split("\n").slice(1).some((line) => {
        const fields = line.trim().split(/\s+/);
        return fields.length > 1 && fields[0] !== "lo";
      })) {
        context.skip("Linux sandbox acceptance requires a loopback-only namespace");
        await rm(sandbox, { recursive: true, force: true });
        return;
      }
    } catch {
      context.skip("Linux sandbox acceptance requires /usr/bin/busybox and /usr/bin/cc");
      await rm(sandbox, { recursive: true, force: true });
      return;
    }
  }
  const llvm = Buffer.from(isWindows
    ? "@echo off\r\nif \"%~1\"==\"--only-keep-debug\" copy /y \"%~2\" \"%~3\" >nul\r\nexit /b 0\r\n"
    : "#!/bin/sh\ncase \"$3\" in *sandbox-failure*) printf '%s\\n' 'tsfg sandbox: injected setup failure' >&2; exit 125 ;; esac\nif [ \"$1\" = --only-keep-debug ]; then < \"$2\" > \"$3\"; fi\nexit 0\n");
  const toolDefinitions = [
    ["archive-extractor", isWindows ? "busybox.cmd" : "bin/busybox.static", lockedShell],
    ["cmake", isWindows ? "bin/cmake.cmd" : "bin/cmake", cmake],
    ["debian-sysroot", "usr/include/assert.h", Buffer.from("fixture sysroot\n")],
    ["llvm", isWindows ? "bin/llvm.cmd" : "bin/llvm", llvm],
    ["ninja", isWindows ? "bin/ninja.cmd" : "bin/ninja", ninja],
    ["node", isWindows ? "node.cmd" : "bin/node", inert],
    ["pnpm", isWindows ? "pnpm.cmd" : "pnpm", inert],
    ["zig", isWindows ? "zig.cmd" : "zig", zig],
  ];
  const server = await startArtifactServer(new Map(
    toolDefinitions.map(([id, , bytes]) => [`/${id}`, bytes]),
  ));
  let serverOpen = true;
  const tools = {};
  for (const [id, installPath, bytes] of toolDefinitions) {
    const artifact = {
      archiveFormat: "raw",
      archiveSha256: fixtureDigest(bytes),
      byteSize: String(bytes.length),
      installPath,
      platform: "test-x86_64",
      unpackedTreeSha256: fixtureTreeDigest(installPath, bytes),
      url: `${server.baseUrl}/${id}`,
    };
    if (id === "llvm") {
      artifact.executables = {
        ar: installPath,
        clang: installPath,
        clangxx: installPath,
        lld: installPath,
        objcopy: installPath,
        ranlib: installPath,
      };
    }
    tools[id] = {
      artifacts: [artifact],
      license: "MIT",
      signature: { kind: "fixture", signer: "tsfg test fixture" },
      version: "fixture",
    };
  }
  const lock = {
    dependencyLocks: [],
    schemaVersion: "1",
    targets: {
      "test-x86_64": { tools: toolDefinitions.map(([id]) => id) },
    },
    tools,
  };
  try {
    await writeFile(lockPath, `${JSON.stringify(lock)}\n`);
    const prefetched = await invoke([
      "prefetch",
      "--lock", lockPath,
      "--cache", cachePath,
      "--platform", "test-x86_64",
    ]);
    assert.equal(prefetched.status, 0, prefetched.stderr);
    await server.close();
    serverOpen = false;

    if (publicationHelper) {
      // Supply the real native control; production still verifies its fixed
      // executable digest. The compiler/payloads in this protocol test are fixtures.
      const controlRoot = path.join(cachePath, "controls", fixtureDigest(publicationHelper).slice(7));
      await mkdir(controlRoot, { recursive: true });
      await writeFile(path.join(controlRoot, "windows-publish.exe"), publicationHelper, { flag: "wx" });
    }
    const { gitExecutable } = await verifyDevelopmentIsolation(sandbox);
    await verifyDeclaredPoliciesAndMissingTools(sandbox, gitExecutable, tools, zig);
    const { report, metadata } = await verifyCleanBuildIdentity(sandbox);
    await verifyReleaseAndRuntimePackage(sandbox, report);
    const { packageReport, archiveBytes } = await verifyIndependentPackages(sandbox, report, metadata);
    await verifyPublicationReplacements(archiveBytes, sandbox, packageReport, context, publicationHelper);
    await verifyNativeFailureCategories(sandbox);
  } finally {
    if (serverOpen) await server.close();
    await rm(sandbox, { recursive: true, force: true });
  }
});
