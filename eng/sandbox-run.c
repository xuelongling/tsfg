// SPDX-License-Identifier: MIT

#define _GNU_SOURCE

#include <errno.h>
#include <arpa/inet.h>
#include <fcntl.h>
#include <linux/capability.h>
#include <limits.h>
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <unistd.h>

enum access_kind { ACCESS_RO, ACCESS_RX, ACCESS_RW };

enum sandbox_status {
  SANDBOX_NETWORK_BOUNDARY_STATUS = 123,
  SANDBOX_UNDECLARED_INPUT_STATUS = 124,
  SANDBOX_SETUP_FAILURE_STATUS = 125,
};

struct allowed_path {
  const char *path;
  enum access_kind access;
};

static void fail_with_status(int status, const char *message, const char *detail) {
  fprintf(stderr, "tsfg sandbox: %s%s%s\n", message, detail ? ": " : "",
          detail ? detail : "");
  exit(status);
}

static void fail(const char *message, const char *detail) {
  fail_with_status(SANDBOX_SETUP_FAILURE_STATUS, message, detail);
}

static void network_fail(const char *message, const char *detail) {
  fail_with_status(SANDBOX_NETWORK_BOUNDARY_STATUS, message, detail);
}

static void write_mapping(const char *path, unsigned int outside_id) {
  int fd = open(path, O_WRONLY | O_CLOEXEC);
  if (fd < 0) fail("cannot open namespace mapping", path);
  char mapping[64];
  int length = snprintf(mapping, sizeof(mapping), "0 %u 1\n", outside_id);
  if (write(fd, mapping, (size_t)length) != length) {
    close(fd);
    fail("cannot write namespace mapping", path);
  }
  close(fd);
}

static void enter_namespaces(void) {
  uid_t uid = getuid();
  gid_t gid = getgid();
  if (unshare(CLONE_NEWUSER) < 0)
    fail("cannot create user namespace", strerror(errno));
  int setgroups = open("/proc/self/setgroups", O_WRONLY | O_CLOEXEC);
  if (setgroups >= 0) {
    if (write(setgroups, "deny\n", 5) != 5) {
      close(setgroups);
      fail("cannot disable namespace setgroups", strerror(errno));
    }
    close(setgroups);
  }
  write_mapping("/proc/self/uid_map", (unsigned int)uid);
  write_mapping("/proc/self/gid_map", (unsigned int)gid);
  if (unshare(CLONE_NEWNS | CLONE_NEWNET) < 0)
    fail("cannot create mount/network namespace", strerror(errno));
  if (mount(NULL, "/", NULL, MS_REC | MS_PRIVATE, NULL) < 0)
    fail("cannot make mounts private", strerror(errno));
}

static void verify_network_isolation(void) {
  int socket_fd = socket(AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (socket_fd < 0) network_fail("cannot create network canary socket", strerror(errno));
  struct sockaddr_in destination = {
      .sin_family = AF_INET,
      .sin_port = htons(443),
  };
  if (inet_pton(AF_INET, "1.1.1.1", &destination.sin_addr) != 1)
    network_fail("cannot configure network canary", NULL);
  if (connect(socket_fd, (struct sockaddr *)&destination, sizeof(destination)) == 0) {
    close(socket_fd);
    network_fail("network canary unexpectedly connected", "1.1.1.1:443");
  }
  int failure = errno;
  close(socket_fd);
  if (failure != ENETUNREACH && failure != EHOSTUNREACH && failure != ENETDOWN)
    network_fail("network canary did not prove isolation", strerror(failure));
}

static void make_parent_directories(char *path) {
  for (char *cursor = path + 1; *cursor; ++cursor) {
    if (*cursor != '/') continue;
    *cursor = '\0';
    if (mkdir(path, 0755) < 0 && errno != EEXIST)
      fail("cannot create sandbox directory", path);
    *cursor = '/';
  }
}

static void bind_path(const char *new_root, const char *source,
                      const char *destination, enum access_kind access) {
  if (source[0] != '/' || destination[0] != '/')
    fail("sandbox paths must be absolute", source);
  struct stat source_stat;
  if (lstat(source, &source_stat) < 0)
    fail("cannot inspect allowed path", source);
  size_t length = strlen(new_root) + strlen(destination) + 1;
  char *target = malloc(length);
  if (!target) fail("cannot allocate sandbox path", NULL);
  snprintf(target, length, "%s%s", new_root, destination);
  make_parent_directories(target);
  if (S_ISDIR(source_stat.st_mode)) {
    if (mkdir(target, 0755) < 0 && errno != EEXIST)
      fail("cannot create sandbox mount point", target);
  } else {
    int fd = open(target, O_CREAT | O_RDONLY | O_CLOEXEC, 0644);
    if (fd < 0) fail("cannot create sandbox file mount point", target);
    close(fd);
  }
  if (mount(source, target, NULL, MS_BIND, NULL) < 0)
    fail("cannot bind allowed path", source);
  unsigned long flags = MS_BIND | MS_REMOUNT | MS_NOSUID | MS_NODEV;
  if (access != ACCESS_RW) flags |= MS_RDONLY;
  if (access == ACCESS_RO) flags |= MS_NOEXEC;
  if (mount(NULL, target, NULL, flags, NULL) < 0)
    fail("cannot constrain allowed path", source);
  free(target);
}

static void pivot_into(const char *new_root, const char *working_directory) {
  char old_root[PATH_MAX];
  snprintf(old_root, sizeof(old_root), "%s/.old-root", new_root);
  if (mkdir(old_root, 0700) < 0) fail("cannot create old-root mount point", strerror(errno));
  if (chdir(new_root) < 0) fail("cannot enter sandbox root", strerror(errno));
  if (syscall(SYS_pivot_root, ".", ".old-root") < 0)
    fail("cannot pivot into sandbox root", strerror(errno));
  if (chdir("/") < 0) fail("cannot select sandbox root", strerror(errno));
  if (umount2("/.old-root", MNT_DETACH) < 0)
    fail("cannot detach host root", strerror(errno));
  if (rmdir("/.old-root") < 0) fail("cannot remove old-root mount point", strerror(errno));
  if (chdir(working_directory) < 0)
    fail("sandbox working directory is not allowed", working_directory);
}

static void drop_namespace_capabilities(void) {
  for (int capability = 0; capability <= 63; ++capability) {
    if (prctl(PR_CAPBSET_DROP, capability, 0, 0, 0) < 0 && errno != EINVAL)
      fail("cannot drop capability bounding set", strerror(errno));
  }
  struct __user_cap_header_struct header = {
      .version = _LINUX_CAPABILITY_VERSION_3,
      .pid = 0,
  };
  struct __user_cap_data_struct data[2] = {{0}, {0}};
  if (syscall(SYS_capset, &header, data) < 0)
    fail("cannot clear namespace capabilities", strerror(errno));
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) < 0)
    fail("cannot set no_new_privs", strerror(errno));
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
  execv(loader, child_argv);
  fail("cannot execute locked LLVM tool", tool);
}

int main(int argc, char **argv) {
  run_locked_llvm_wrapper(argc, argv);
  struct allowed_path allowed[32];
  size_t allowed_count = 0;
  const char *new_root = NULL;
  const char *shell = NULL;
  int index = 1;
  while (index < argc && strcmp(argv[index], "--") != 0) {
    if (index + 1 >= argc) fail("missing sandbox option value", argv[index]);
    if (strcmp(argv[index], "--root") == 0) {
      new_root = argv[index + 1];
    } else if (strcmp(argv[index], "--shell") == 0) {
      shell = argv[index + 1];
    } else {
      if (allowed_count == sizeof(allowed) / sizeof(allowed[0]))
        fail("too many allowed paths", NULL);
      enum access_kind access;
      if (strcmp(argv[index], "--ro") == 0) access = ACCESS_RO;
      else if (strcmp(argv[index], "--rx") == 0) access = ACCESS_RX;
      else if (strcmp(argv[index], "--rw") == 0) access = ACCESS_RW;
      else fail("unknown option", argv[index]);
      allowed[allowed_count++] = (struct allowed_path){argv[index + 1], access};
    }
    index += 2;
  }
  if (!new_root || !shell || index >= argc || index + 1 >= argc)
    fail("missing sandbox root, shell, or command", NULL);
  char working_directory[PATH_MAX];
  if (!getcwd(working_directory, sizeof(working_directory)))
    fail("cannot read working directory", strerror(errno));

  enter_namespaces();
  verify_network_isolation();
  if (mkdir(new_root, 0700) < 0 && errno != EEXIST)
    fail("cannot create sandbox root", strerror(errno));
  struct stat root_stat;
  if (lstat(new_root, &root_stat) < 0 || !S_ISDIR(root_stat.st_mode))
    fail("sandbox root is not a directory", new_root);
  if (mount("tmpfs", new_root, "tmpfs", MS_NOSUID | MS_NODEV, "mode=0755,size=64m") < 0)
    fail("cannot mount sandbox root", strerror(errno));
  for (size_t path_index = 0; path_index < allowed_count; ++path_index)
    bind_path(new_root, allowed[path_index].path, allowed[path_index].path,
              allowed[path_index].access);
  bind_path(new_root, shell, "/bin/sh", ACCESS_RX);
  bind_path(new_root, "/dev/null", "/dev/null", ACCESS_RW);
  pivot_into(new_root, working_directory);
  drop_namespace_capabilities();
  char undeclared_status[4];
  snprintf(undeclared_status, sizeof(undeclared_status), "%d",
           SANDBOX_UNDECLARED_INPUT_STATUS);
  if (setenv("TSFG_SANDBOX_UNDECLARED_INPUT_STATUS", undeclared_status, 1) < 0)
    fail("cannot publish sandbox control protocol", strerror(errno));
  execv(argv[index + 1], &argv[index + 1]);
  fail("cannot execute command", argv[index + 1]);
}
