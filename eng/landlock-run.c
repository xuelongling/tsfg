// SPDX-License-Identifier: MIT

#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <linux/landlock.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>

#ifndef LANDLOCK_ACCESS_FS_REFER
#define LANDLOCK_ACCESS_FS_REFER (1ULL << 13)
#endif
#ifndef LANDLOCK_ACCESS_FS_TRUNCATE
#define LANDLOCK_ACCESS_FS_TRUNCATE (1ULL << 14)
#endif

static int landlock_create_ruleset(const struct landlock_ruleset_attr *attr,
                                   size_t size, uint32_t flags) {
  return (int)syscall(__NR_landlock_create_ruleset, attr, size, flags);
}

static int landlock_add_rule(int ruleset_fd,
                             const struct landlock_path_beneath_attr *attr) {
  return (int)syscall(__NR_landlock_add_rule, ruleset_fd,
                      LANDLOCK_RULE_PATH_BENEATH, attr, 0);
}

static int landlock_restrict_self(int ruleset_fd) {
  return (int)syscall(__NR_landlock_restrict_self, ruleset_fd, 0);
}

static void fail(const char *message, const char *detail) {
  fprintf(stderr, "tsfg sandbox: %s%s%s\n", message, detail ? ": " : "",
          detail ? detail : "");
  exit(125);
}

static void add_path(int ruleset_fd, const char *path, uint64_t access) {
  int path_fd = open(path, O_PATH | O_CLOEXEC);
  if (path_fd < 0) fail("cannot open allowed path", path);
  struct landlock_path_beneath_attr rule = {
      .allowed_access = access,
      .parent_fd = path_fd,
  };
  if (landlock_add_rule(ruleset_fd, &rule) < 0) {
    close(path_fd);
    fail("cannot add allowed path", path);
  }
  close(path_fd);
}

static void run_locked_llvm_wrapper(int argc, char **argv) {
  const char *loader = getenv("TSFG_LOCKED_LOADER");
  if (!loader) return;
  const char *name = strrchr(argv[0], '/');
  name = name ? name + 1 : argv[0];
  const char *tool = NULL;
  const char *leading = NULL;
  if (strcmp(name, "clang++") == 0) {
    tool = getenv("TSFG_LOCKED_CLANGXX");
    leading = getenv("TSFG_LOCKED_CLANG_RESOURCE");
  } else if (strcmp(name, "ld.lld") == 0) {
    tool = getenv("TSFG_LOCKED_LLD");
  } else if (strcmp(name, "llvm-ar") == 0) {
    tool = getenv("TSFG_LOCKED_AR");
  } else if (strcmp(name, "llvm-ranlib") == 0) {
    tool = getenv("TSFG_LOCKED_RANLIB");
  } else {
    return;
  }
  const char *libraries = getenv("TSFG_LOCKED_LIBRARIES");
  if (!tool || !libraries) fail("incomplete locked LLVM wrapper environment", name);
  char **child_argv = calloc((size_t)argc + 6, sizeof(char *));
  if (!child_argv) fail("cannot allocate wrapper arguments", NULL);
  int child_index = 0;
  child_argv[child_index++] = (char *)loader;
  child_argv[child_index++] = "--library-path";
  child_argv[child_index++] = (char *)libraries;
  child_argv[child_index++] = (char *)tool;
  if (leading) child_argv[child_index++] = (char *)leading;
  for (int index = 1; index < argc; ++index)
    child_argv[child_index++] = argv[index];
  child_argv[child_index] = NULL;
  execv(loader, child_argv);
  fail("cannot execute locked LLVM tool", tool);
}

int main(int argc, char **argv) {
  run_locked_llvm_wrapper(argc, argv);
  int abi = landlock_create_ruleset(NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
  if (abi < 3) fail("Landlock ABI 3 is required", NULL);

  uint64_t read_access = LANDLOCK_ACCESS_FS_READ_FILE |
                         LANDLOCK_ACCESS_FS_READ_DIR;
  uint64_t execute_access = read_access | LANDLOCK_ACCESS_FS_EXECUTE;
  uint64_t write_access = execute_access | LANDLOCK_ACCESS_FS_WRITE_FILE |
                          LANDLOCK_ACCESS_FS_REMOVE_DIR |
                          LANDLOCK_ACCESS_FS_REMOVE_FILE |
                          LANDLOCK_ACCESS_FS_MAKE_CHAR |
                          LANDLOCK_ACCESS_FS_MAKE_DIR |
                          LANDLOCK_ACCESS_FS_MAKE_REG |
                          LANDLOCK_ACCESS_FS_MAKE_SOCK |
                          LANDLOCK_ACCESS_FS_MAKE_FIFO |
                          LANDLOCK_ACCESS_FS_MAKE_BLOCK |
                          LANDLOCK_ACCESS_FS_MAKE_SYM |
                          LANDLOCK_ACCESS_FS_REFER |
                          LANDLOCK_ACCESS_FS_TRUNCATE;
  struct landlock_ruleset_attr ruleset = {.handled_access_fs = write_access};
  int ruleset_fd = landlock_create_ruleset(&ruleset, sizeof(ruleset), 0);
  if (ruleset_fd < 0) fail("cannot create Landlock ruleset", strerror(errno));

  int index = 1;
  for (; index < argc && strcmp(argv[index], "--") != 0; index += 2) {
    if (index + 1 >= argc) fail("missing allowed path", NULL);
    uint64_t access;
    if (strcmp(argv[index], "--ro") == 0) access = read_access;
    else if (strcmp(argv[index], "--rx") == 0) access = execute_access;
    else if (strcmp(argv[index], "--rw") == 0) access = write_access;
    else fail("unknown option", argv[index]);
    add_path(ruleset_fd, argv[index + 1], access);
  }
  if (index >= argc || index + 1 >= argc) fail("missing command", NULL);
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) < 0)
    fail("cannot set no_new_privs", strerror(errno));
  if (landlock_restrict_self(ruleset_fd) < 0)
    fail("cannot apply Landlock ruleset", strerror(errno));
  close(ruleset_fd);
  execv(argv[index + 1], &argv[index + 1]);
  fail("cannot execute command", argv[index + 1]);
}
