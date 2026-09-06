// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

test("Linux sandbox accepts only a precreated root mapping to an unprivileged host identity", async () => {
  const source = await readFile(path.join(repositoryRoot, "eng", "sandbox-run.c"), "utf8");
  assert.match(source, /root_is_mapped_to_unprivileged\("\/proc\/self\/uid_map"\)/);
  assert.match(source, /root_is_mapped_to_unprivileged\("\/proc\/self\/gid_map"\)/);
  assert.match(source, /outside_id != 0 &&\s+mapping_length == 1/);
  assert.match(
    source,
    /mount\(source, target, NULL, MS_BIND, NULL\)[\s\S]*strcmp\(destination, "\/dev\/null"\) == 0[\s\S]*MS_BIND \| MS_REMOUNT/,
  );
  assert.match(
    source,
    /child_argv\[child_index\+\+\] = "--inhibit-cache"/,
    "locked dynamic-loader wrappers must not consult the host ld.so cache",
  );
  assert.match(
    source,
    /strcmp\(name, "ninja"\)[\s\S]*TSFG_LOCKED_NINJA/,
    "CMake's Ninja probe must enter through the locked loader wrapper",
  );
  assert.match(source, /TSFG_LOCKED_LOADER[\s\S]*\/lib64\/ld-linux-x86-64\.so\.2/);
  assert.match(source, /TSFG_LOCKED_LIB_DIRECTORY[\s\S]*\/lib\/x86_64-linux-gnu/);
  assert.match(source, /TSFG_LOCKED_USR_LIB_DIRECTORY[\s\S]*\/usr\/lib\/x86_64-linux-gnu/);
  assert.match(source, /TSFG_CANONICAL_SOURCE[\s\S]*\/workspace[\s\S]*ACCESS_RO/);
  assert.match(source, /TSFG_CANONICAL_WORK[\s\S]*\/build[\s\S]*ACCESS_RW/);
  assert.match(source, /TSFG_CANONICAL_TOOLCHAIN[\s\S]*\/toolchain[\s\S]*ACCESS_RX/);
  assert.match(
    source,
    /process_index = traced_count;\s+traced\[traced_count\+\+\]\.pid = stopped/,
    "ptrace descendants must be registered idempotently when syscall stops race clone events",
  );
  assert.match(
    source,
    /PTRACE_GET_SYSCALL_INFO[\s\S]*PTRACE_SYSCALL_INFO_ENTRY[\s\S]*audit_syscall/,
    "syscall entry and exit stops must be classified explicitly",
  );
});

test("Linux sandbox supervisor owns boundary statuses and audits descendants", async (context) => {
  if (process.platform !== "linux") {
    context.skip("ptrace sandbox acceptance is Linux-only");
    return;
  }
  const compiler = "/usr/bin/cc";
  try {
    await stat(compiler);
  } catch {
    context.skip("sandbox acceptance requires /usr/bin/cc");
    return;
  }

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "tsfg-sandbox-runner-"));
  const sourceRoot = path.join(temporaryRoot, "source");
  const sourceSubdirectory = path.join(sourceRoot, "sub");
  const workRoot = path.join(temporaryRoot, "work");
  const controlRoot = path.join(temporaryRoot, "control");
  const sandboxRoot = path.join(temporaryRoot, "sandbox");
  const declaredPath = path.join(sourceRoot, "declared.txt");
  const writablePath = path.join(workRoot, "writable.txt");
  const outsidePath = path.join(temporaryRoot, "outside.txt");
  const missingOutsidePath = path.join(temporaryRoot, "missing-outside.txt");
  const runner = path.join(controlRoot, "sandbox-run");
  const probe = path.join(controlRoot, "probe");
  const probeSource = path.join(controlRoot, "probe.c");

  try {
    await mkdir(sourceSubdirectory, { recursive: true });
    await mkdir(workRoot, { recursive: true });
    await mkdir(controlRoot, { recursive: true });
    await writeFile(declaredPath, "declared\n");
    await writeFile(writablePath, "writable\n");
    await writeFile(outsidePath, "outside\n");
    await writeFile(probeSource, `
#include <fcntl.h>
#include <errno.h>
#include <linux/io_uring.h>
#include <limits.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

static void ignored_read(const char *path) {
  int fd = open(path, O_RDONLY);
  if (fd >= 0) close(fd);
}

int main(int argc, char **argv) {
  if (argc < 2) return 2;
  if (strcmp(argv[1], "collision") == 0) return 124;
  if (strcmp(argv[1], "read") == 0) {
    ignored_read(argv[2]);
    return 0;
  }
  if (strcmp(argv[1], "failed-read-error") == 0) {
    ignored_read(argv[2]);
    return 7;
  }
  if (strcmp(argv[1], "write") == 0) {
    int fd = open(argv[2], O_WRONLY | O_APPEND);
    if (fd >= 0) close(fd);
    return 0;
  }
  if (strcmp(argv[1], "access") == 0) {
    access(argv[2], W_OK);
    return 0;
  }
  if (strcmp(argv[1], "mkdir") == 0) {
    mkdir(argv[2], 0755);
    return 0;
  }
  if (strcmp(argv[1], "io-uring") == 0) {
    struct io_uring_params parameters = {0};
    errno = 0;
    return syscall(SYS_io_uring_setup, 1, &parameters) == -1 && errno == ENOSYS
      ? 0
      : 4;
  }
  if (strcmp(argv[1], "socket-stat") == 0) {
    int fd = socket(AF_UNIX, SOCK_STREAM, 0);
    struct stat metadata;
    if (fd < 0) return 5;
    int result = syscall(SYS_newfstatat, fd, "", &metadata, AT_EMPTY_PATH);
    close(fd);
    return result == 0 ? 0 : 6;
  }
  if (strcmp(argv[1], "self-exe") == 0) {
    char executable[PATH_MAX];
    ssize_t length = readlink("/proc/self/exe", executable, sizeof(executable));
    return length > 0 ? 0 : 8;
  }
  if (strcmp(argv[1], "page-edge-read") == 0) {
    long page_size = sysconf(_SC_PAGESIZE);
    if (page_size <= 0) return 9;
    char *pages = mmap(NULL, (size_t)page_size * 2, PROT_READ | PROT_WRITE,
                       MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (pages == MAP_FAILED || mprotect(pages + page_size, (size_t)page_size,
                                        PROT_NONE) != 0)
      return 10;
    size_t length = strlen(argv[2]) + 1;
    char *page_edge_path = pages + page_size - length;
    memcpy(page_edge_path, argv[2], length);
    int fd = open(page_edge_path, O_RDONLY);
    if (fd >= 0) close(fd);
    return fd >= 0 ? 0 : 11;
  }
  if (strcmp(argv[1], "futimens") == 0) {
    int fd = open(argv[2], O_WRONLY);
    if (fd < 0) return 12;
    int result = futimens(fd, NULL);
    close(fd);
    return result == 0 ? 0 : 13;
  }
  if (strcmp(argv[1], "descendant") == 0) {
    pid_t child = fork();
    if (child == 0) {
      setsid();
      ignored_read(argv[2]);
      _exit(0);
    }
    int status = 0;
    waitpid(child, &status, 0);
    return 0;
  }
  if (strcmp(argv[1], "hardlink") == 0) {
    link(argv[2], argv[3]);
    return 0;
  }
  return 3;
}
`);
    for (const [source, output] of [
      [path.join(repositoryRoot, "eng", "sandbox-run.c"), runner],
      [probeSource, probe],
    ]) {
      const compiled = spawnSync(
        compiler,
        ["-static", "-O2", source, "-o", output],
        { encoding: "utf8" },
      );
      if (compiled.status !== 0) {
        context.skip(`static sandbox acceptance compiler unavailable: ${compiled.stderr}`);
        return;
      }
    }

    const invoke = (scenario, ...targets) => spawnSync(
      runner,
      [
        "--root", sandboxRoot,
        "--shell", probe,
        "--ro", declaredPath,
        "--ro", sourceSubdirectory,
        "--rx", probe,
        "--rw", workRoot,
        "--",
        probe,
        scenario,
        ...targets,
      ],
      { cwd: workRoot, encoding: "utf8", timeout: 10_000 },
    );

    const allowed = invoke("read", path.join(sourceSubdirectory, "..", "declared.txt"));
    if (allowed.status === 125 && /cannot create user namespace/.test(allowed.stderr)) {
      context.skip("unprivileged user namespaces are unavailable");
      return;
    }
    assert.equal(allowed.status, 0, allowed.stderr);

    const failedProbe = invoke("read", missingOutsidePath);
    assert.equal(failedProbe.status, 0, failedProbe.stderr);

    const diagnosedFailedProbe = invoke("failed-read-error", missingOutsidePath);
    assert.equal(diagnosedFailedProbe.status, 7, diagnosedFailedProbe.stderr);
    assert.match(diagnosedFailedProbe.stderr, /failed undeclared read probe/);
    assert.match(diagnosedFailedProbe.stderr, /missing-outside\.txt/);

    const allowedPermissionProbe = invoke("access", sourceRoot);
    assert.equal(allowedPermissionProbe.status, 0, allowedPermissionProbe.stderr);

    const allowedAncestorCreationProbe = invoke("mkdir", temporaryRoot);
    assert.equal(
      allowedAncestorCreationProbe.status,
      0,
      allowedAncestorCreationProbe.stderr,
    );

    const unavailableIoUring = invoke("io-uring");
    assert.equal(unavailableIoUring.status, 0, unavailableIoUring.stderr);

    const socketMetadata = invoke("socket-stat");
    assert.equal(socketMetadata.status, 0, socketMetadata.stderr);

    const processExecutable = invoke("self-exe");
    assert.equal(processExecutable.status, 0, processExecutable.stderr);

    const pageEdgeRead = invoke("page-edge-read", declaredPath);
    assert.equal(pageEdgeRead.status, 0, pageEdgeRead.stderr);

    const descriptorTimestamp = invoke("futimens", writablePath);
    assert.equal(descriptorTimestamp.status, 0, descriptorTimestamp.stderr);

    const ignoredRead = invoke("read", outsidePath);
    assert.equal(ignoredRead.status, 124, ignoredRead.stderr);
    assert.match(ignoredRead.stderr, /denied path access/);

    const ignoredWrite = invoke("write", declaredPath);
    assert.equal(ignoredWrite.status, 124, ignoredWrite.stderr);
    assert.equal(await readFile(declaredPath, "utf8"), "declared\n");

    const hardlinkPath = path.join(workRoot, "declared-link.txt");
    const ignoredHardlink = invoke("hardlink", declaredPath, hardlinkPath);
    assert.equal(ignoredHardlink.status, 124, ignoredHardlink.stderr);
    await assert.rejects(stat(hardlinkPath), /ENOENT/);

    const detachedDescendant = invoke("descendant", outsidePath);
    assert.equal(detachedDescendant.signal, null, detachedDescendant.error?.message);
    assert.equal(detachedDescendant.status, 124, detachedDescendant.stderr);

    const collision = invoke("collision", declaredPath);
    assert.equal(collision.status, 122, collision.stderr);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
