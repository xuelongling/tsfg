// SPDX-License-Identifier: MIT

#define _GNU_SOURCE

#include <errno.h>
#include <arpa/inet.h>
#include <fcntl.h>
#include <linux/capability.h>
#include <linux/openat2.h>
#include <limits.h>
#include <sched.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/prctl.h>
#include <sys/ptrace.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/user.h>
#include <sys/wait.h>
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
  int is_directory;
};

static int proc_fd = -1;

_Noreturn static void fail_with_status(int status, const char *message,
                                       const char *detail) {
  fprintf(stderr, "tsfg sandbox: %s%s%s\n", message, detail ? ": " : "",
          detail ? detail : "");
  exit(status);
}

_Noreturn static void fail(const char *message, const char *detail) {
  fail_with_status(SANDBOX_SETUP_FAILURE_STATUS, message, detail);
}

_Noreturn static void network_fail(const char *message, const char *detail) {
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

static int root_is_mapped_to_unprivileged(const char *path) {
  FILE *mapping = fopen(path, "re");
  if (!mapping) return 0;
  unsigned long inside_id = 0;
  unsigned long outside_id = 0;
  unsigned long mapping_length = 0;
  char extra = '\0';
  int fields = fscanf(mapping, "%lu %lu %lu %c", &inside_id, &outside_id,
                      &mapping_length, &extra);
  fclose(mapping);
  return fields == 3 && inside_id == 0 && outside_id != 0 &&
         mapping_length == 1;
}

static int has_precreated_unprivileged_user_namespace(void) {
  return geteuid() == 0 && getegid() == 0 &&
         root_is_mapped_to_unprivileged("/proc/self/uid_map") &&
         root_is_mapped_to_unprivileged("/proc/self/gid_map");
}

static void enter_namespaces(void) {
  if (!has_precreated_unprivileged_user_namespace()) {
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
  }
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

static void bind_path(const char *new_root, struct allowed_path *allowed,
                      const char *destination) {
  const char *source = allowed->path;
  enum access_kind access = allowed->access;
  if (source[0] != '/' || destination[0] != '/')
    fail("sandbox paths must be absolute", source);
  struct stat source_stat;
  if (lstat(source, &source_stat) < 0)
    fail("cannot inspect allowed path", source);
  allowed->is_directory = S_ISDIR(source_stat.st_mode);
  size_t length = strlen(new_root) + strlen(destination) + 1;
  char *target = malloc(length);
  if (!target) fail("cannot allocate sandbox path", NULL);
  snprintf(target, length, "%s%s", new_root, destination);
  make_parent_directories(target);
  if (allowed->is_directory) {
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

static int read_tracee_bytes(pid_t pid, unsigned long address, void *buffer,
                             size_t length) {
  unsigned char *output = buffer;
  for (size_t offset = 0; offset < length; offset += sizeof(long)) {
    errno = 0;
    long word = ptrace(PTRACE_PEEKDATA, pid, address + offset, NULL);
    if (errno != 0) return -1;
    size_t remaining = length - offset;
    size_t count = remaining < sizeof(word) ? remaining : sizeof(word);
    memcpy(output + offset, &word, count);
  }
  return 0;
}

static int read_tracee_string(pid_t pid, unsigned long address, char *buffer,
                              size_t length) {
  if (address == 0 || length == 0) return -1;
  for (size_t offset = 0; offset < length; offset += sizeof(long)) {
    errno = 0;
    long word = ptrace(PTRACE_PEEKDATA, pid, address + offset, NULL);
    if (errno != 0) return -1;
    size_t remaining = length - offset;
    size_t count = remaining < sizeof(word) ? remaining : sizeof(word);
    memcpy(buffer + offset, &word, count);
    if (memchr(&word, '\0', count)) return 0;
  }
  buffer[length - 1] = '\0';
  return -1;
}

static int read_process_link(pid_t pid, int descriptor, char *buffer,
                             size_t length) {
  char link[64];
  if (descriptor == AT_FDCWD)
    snprintf(link, sizeof(link), "%d/cwd", pid);
  else
    snprintf(link, sizeof(link), "%d/fd/%d", pid, descriptor);
  ssize_t count = readlinkat(proc_fd, link, buffer, length - 1);
  if (count < 0 || (size_t)count >= length - 1) return -1;
  buffer[count] = '\0';
  const char deleted[] = " (deleted)";
  size_t buffer_length = strlen(buffer);
  size_t deleted_length = sizeof(deleted) - 1;
  if (buffer_length >= deleted_length &&
      strcmp(buffer + buffer_length - deleted_length, deleted) == 0)
    buffer[buffer_length - deleted_length] = '\0';
  return 0;
}

static int normalize_path(const char *base, const char *input, char *output,
                          size_t length) {
  char combined[PATH_MAX * 2];
  int written = input[0] == '/'
                    ? snprintf(combined, sizeof(combined), "%s", input)
                    : snprintf(combined, sizeof(combined), "%s/%s", base, input);
  if (written < 0 || (size_t)written >= sizeof(combined) || length < 2) return -1;
  size_t output_length = 1;
  output[0] = '/';
  output[1] = '\0';
  char *save = NULL;
  for (char *part = strtok_r(combined, "/", &save); part;
       part = strtok_r(NULL, "/", &save)) {
    if (strcmp(part, ".") == 0 || part[0] == '\0') continue;
    if (strcmp(part, "..") == 0) {
      if (output_length > 1) {
        --output_length;
        while (output_length > 1 && output[output_length - 1] != '/')
          --output_length;
        if (output_length > 1) --output_length;
        output[output_length] = '\0';
      }
      continue;
    }
    size_t part_length = strlen(part);
    size_t separator = output_length > 1 ? 1 : 0;
    if (output_length + separator + part_length >= length) return -1;
    if (separator) output[output_length++] = '/';
    memcpy(output + output_length, part, part_length + 1);
    output_length += part_length;
  }
  return 0;
}

static int path_contains(const char *root, int root_is_directory,
                         const char *candidate) {
  size_t root_length = strlen(root);
  if (strcmp(root, candidate) == 0) return 1;
  return root_is_directory && strncmp(root, candidate, root_length) == 0 &&
         candidate[root_length] == '/';
}

static int path_is_ancestor(const char *candidate, const char *allowed) {
  size_t candidate_length = strlen(candidate);
  if (candidate_length == 1 && candidate[0] == '/') return 1;
  return strncmp(candidate, allowed, candidate_length) == 0 &&
         allowed[candidate_length] == '/';
}

static int path_is_allowed(const char *candidate, int wants_write,
                           struct allowed_path *allowed, size_t allowed_count) {
  if (strcmp(candidate, "/bin/sh") == 0 ||
      (!wants_write && path_is_ancestor(candidate, "/bin/sh")))
    return !wants_write;
  if (strcmp(candidate, "/dev/null") == 0 ||
      (!wants_write && path_is_ancestor(candidate, "/dev/null")))
    return 1;
  for (size_t index = 0; index < allowed_count; ++index) {
    if (path_contains(allowed[index].path, allowed[index].is_directory,
                      candidate))
      return !wants_write || allowed[index].access == ACCESS_RW;
    if (!wants_write && path_is_ancestor(candidate, allowed[index].path))
      return 1;
  }
  return 0;
}

static int audit_path(pid_t pid, int descriptor, unsigned long address,
                      int wants_write, struct allowed_path *allowed,
                      size_t allowed_count, char *denied, size_t denied_length) {
  char input[PATH_MAX];
  char base[PATH_MAX];
  if (read_tracee_string(pid, address, input, sizeof(input)) < 0) {
    snprintf(denied, denied_length, "unreadable-tracee-path");
    return 1;
  }
  if (input[0] == '\0') {
    if (descriptor == AT_FDCWD) return 0;
    if (read_process_link(pid, descriptor, base, sizeof(base)) < 0) {
      snprintf(denied, denied_length, "unresolvable-tracee-directory");
      return 1;
    }
    char candidate[PATH_MAX];
    if (normalize_path("/", base, candidate, sizeof(candidate)) < 0) {
      snprintf(denied, denied_length, "unnormalizable-tracee-path");
      return 1;
    }
    if (path_is_allowed(candidate, wants_write, allowed, allowed_count)) return 0;
    snprintf(denied, denied_length, "%s", candidate);
    return 1;
  }
  if (input[0] == '/') {
    strcpy(base, "/");
  } else if (read_process_link(pid, descriptor, base, sizeof(base)) < 0) {
    snprintf(denied, denied_length, "unresolvable-tracee-directory");
    return 1;
  }
  char candidate[PATH_MAX];
  if (normalize_path(base, input, candidate, sizeof(candidate)) < 0) {
    snprintf(denied, denied_length, "unnormalizable-tracee-path");
    return 1;
  }
  if (path_is_allowed(candidate, wants_write, allowed, allowed_count)) return 0;
  snprintf(denied, denied_length, "%s", candidate);
  return 1;
}

static int audit_syscall(pid_t pid, const struct user_regs_struct *registers,
                         struct allowed_path *allowed, size_t allowed_count,
                         char *denied, size_t denied_length) {
  long syscall_number = (long)registers->orig_rax;
  int descriptor = AT_FDCWD;
  unsigned long address = 0;
  int wants_write = 0;
  switch (syscall_number) {
#ifdef SYS_creat
    case SYS_creat:
      address = registers->rdi;
      wants_write = 1;
      break;
#endif
#ifdef SYS_open
    case SYS_open:
      address = registers->rdi;
      wants_write = ((int)registers->rsi &
                     (O_WRONLY | O_RDWR | O_CREAT | O_TRUNC | O_APPEND)) != 0;
      break;
#endif
    case SYS_openat:
      descriptor = (int)registers->rdi;
      address = registers->rsi;
      wants_write = ((int)registers->rdx &
                     (O_WRONLY | O_RDWR | O_CREAT | O_TRUNC | O_APPEND)) != 0;
      break;
#ifdef SYS_openat2
    case SYS_openat2: {
      descriptor = (int)registers->rdi;
      address = registers->rsi;
      struct open_how how = {0};
      if (read_tracee_bytes(pid, registers->rdx, &how, sizeof(how)) == 0)
        wants_write = (how.flags &
                       (O_WRONLY | O_RDWR | O_CREAT | O_TRUNC | O_APPEND)) != 0;
      break;
    }
#endif
#ifdef SYS_access
    case SYS_access:
      address = registers->rdi;
      wants_write = ((int)registers->rsi & W_OK) != 0;
      break;
#endif
    case SYS_faccessat:
      descriptor = (int)registers->rdi;
      address = registers->rsi;
      wants_write = ((int)registers->rdx & W_OK) != 0;
      break;
#ifdef SYS_faccessat2
    case SYS_faccessat2:
      descriptor = (int)registers->rdi;
      address = registers->rsi;
      wants_write = ((int)registers->rdx & W_OK) != 0;
      break;
#endif
#ifdef SYS_stat
    case SYS_stat:
    case SYS_lstat:
      address = registers->rdi;
      break;
#endif
    case SYS_execve:
    case SYS_chdir:
    case SYS_statfs:
      address = registers->rdi;
      break;
#ifdef SYS_execveat
    case SYS_execveat:
      descriptor = (int)registers->rdi;
      address = registers->rsi;
      break;
#endif
    case SYS_newfstatat:
    case SYS_statx:
      descriptor = (int)registers->rdi;
      address = registers->rsi;
      break;
    case SYS_readlink:
      address = registers->rdi;
      break;
    case SYS_readlinkat:
      descriptor = (int)registers->rdi;
      address = registers->rsi;
      break;
#ifdef SYS_truncate
    case SYS_truncate:
    case SYS_unlink:
    case SYS_rmdir:
    case SYS_mkdir:
    case SYS_mknod:
    case SYS_chmod:
    case SYS_chown:
    case SYS_lchown:
    case SYS_utime:
    case SYS_utimes:
    case SYS_setxattr:
    case SYS_lsetxattr:
    case SYS_removexattr:
    case SYS_lremovexattr:
    case SYS_chroot:
      address = registers->rdi;
      wants_write = 1;
      break;
#endif
    case SYS_unlinkat:
    case SYS_mkdirat:
    case SYS_mknodat:
    case SYS_fchmodat:
    case SYS_fchownat:
    case SYS_futimesat:
    case SYS_utimensat:
      descriptor = (int)registers->rdi;
      address = registers->rsi;
      wants_write = 1;
      break;
#ifdef SYS_fchmodat2
    case SYS_fchmodat2:
      descriptor = (int)registers->rdi;
      address = registers->rsi;
      wants_write = 1;
      break;
#endif
    case SYS_getxattr:
    case SYS_lgetxattr:
    case SYS_listxattr:
    case SYS_llistxattr:
      address = registers->rdi;
      break;
    case SYS_rename:
      if (audit_path(pid, AT_FDCWD, registers->rdi, 1, allowed,
                     allowed_count, denied, denied_length))
        return 1;
      address = registers->rsi;
      wants_write = 1;
      break;
    case SYS_renameat:
#ifdef SYS_renameat2
    case SYS_renameat2:
#endif
      if (audit_path(pid, (int)registers->rdi, registers->rsi, 1, allowed,
                     allowed_count, denied, denied_length))
        return 1;
      descriptor = (int)registers->rdx;
      address = registers->r10;
      wants_write = 1;
      break;
    case SYS_link:
      if (audit_path(pid, AT_FDCWD, registers->rdi, 1, allowed,
                     allowed_count, denied, denied_length))
        return 1;
      address = registers->rsi;
      wants_write = 1;
      break;
    case SYS_linkat:
      if (audit_path(pid, (int)registers->rdi, registers->rsi, 1, allowed,
                     allowed_count, denied, denied_length))
        return 1;
      descriptor = (int)registers->rdx;
      address = registers->r10;
      wants_write = 1;
      break;
    case SYS_symlink:
      address = registers->rsi;
      wants_write = 1;
      break;
    case SYS_symlinkat:
      descriptor = (int)registers->rsi;
      address = registers->rdx;
      wants_write = 1;
      break;
#ifdef SYS_name_to_handle_at
    case SYS_name_to_handle_at:
      descriptor = (int)registers->rdi;
      address = registers->rsi;
      break;
#endif
    case SYS_inotify_add_watch:
      descriptor = AT_FDCWD;
      address = registers->rsi;
      break;
#ifdef SYS_fanotify_mark
    case SYS_fanotify_mark:
      descriptor = (int)registers->r10;
      address = registers->r8;
      break;
#endif
    case SYS_acct:
    case SYS_swapon:
      address = registers->rdi;
      wants_write = 1;
      break;
    case SYS_quotactl:
      address = registers->rsi;
      wants_write = 1;
      break;
    case SYS_mount:
      address = registers->rsi;
      wants_write = 1;
      break;
    case SYS_umount2:
    case SYS_swapoff:
      address = registers->rdi;
      wants_write = 1;
      break;
    case SYS_pivot_root:
      if (audit_path(pid, AT_FDCWD, registers->rdi, 1, allowed,
                     allowed_count, denied, denied_length))
        return 1;
      address = registers->rsi;
      wants_write = 1;
      break;
#ifdef SYS_open_tree
    case SYS_open_tree:
    case SYS_fspick:
      descriptor = (int)registers->rdi;
      address = registers->rsi;
      break;
#endif
#ifdef SYS_move_mount
    case SYS_move_mount:
      if (audit_path(pid, (int)registers->rdi, registers->rsi, 1, allowed,
                     allowed_count, denied, denied_length))
        return 1;
      descriptor = (int)registers->rdx;
      address = registers->r10;
      wants_write = 1;
      break;
#endif
#ifdef SYS_mount_setattr
    case SYS_mount_setattr:
      descriptor = (int)registers->rdi;
      address = registers->rsi;
      wants_write = 1;
      break;
#endif
#ifdef SYS_open_by_handle_at
    case SYS_open_by_handle_at:
#endif
#ifdef SYS_io_uring_setup
    case SYS_io_uring_setup:
#endif
#ifdef SYS_fsopen
    case SYS_fsopen:
    case SYS_fsconfig:
    case SYS_fsmount:
#endif
      snprintf(denied, denied_length, "unsupported-filesystem-syscall:%ld",
               syscall_number);
      return 1;
    default:
      return 0;
  }
  return audit_path(pid, descriptor, address, wants_write, allowed,
                    allowed_count, denied, denied_length);
}

static int supervise_command(char **arguments, struct allowed_path *allowed,
                             size_t allowed_count) {
  enum { MAX_TRACED_PROCESSES = 4096 };
  pid_t traced[MAX_TRACED_PROCESSES];
  size_t traced_count = 0;
  pid_t child = fork();
  if (child < 0) fail("cannot fork sandbox command", strerror(errno));
  if (child == 0) {
    if (setpgid(0, 0) < 0) fail("cannot isolate sandbox process group", strerror(errno));
    if (ptrace(PTRACE_TRACEME, 0, NULL, NULL) < 0)
      fail("cannot enable sandbox access audit", strerror(errno));
    raise(SIGSTOP);
    execv(arguments[0], arguments);
    fail("cannot execute command", arguments[0]);
  }

  int status = 0;
  if (waitpid(child, &status, 0) != child || !WIFSTOPPED(status))
    fail("sandbox command did not enter audit", NULL);
  long options = PTRACE_O_TRACESYSGOOD | PTRACE_O_TRACEEXEC |
                 PTRACE_O_TRACEFORK | PTRACE_O_TRACEVFORK |
                 PTRACE_O_TRACECLONE | PTRACE_O_EXITKILL;
  if (ptrace(PTRACE_SETOPTIONS, child, NULL, options) < 0)
    fail("cannot configure sandbox access audit", strerror(errno));
  if (ptrace(PTRACE_SYSCALL, child, NULL, NULL) < 0)
    fail("cannot start sandbox access audit", strerror(errno));
  traced[traced_count++] = child;

  int child_executed = 0;
  for (;;) {
    pid_t stopped = waitpid(-1, &status, __WALL);
    if (stopped < 0) fail("cannot wait for sandbox command", strerror(errno));
    if (WIFEXITED(status)) {
      for (size_t index = 0; index < traced_count; ++index) {
        if (traced[index] == stopped) traced[index] = -1;
      }
      if (stopped != child) continue;
      int code = WEXITSTATUS(status);
      if (!child_executed) return SANDBOX_SETUP_FAILURE_STATUS;
      if (code >= SANDBOX_NETWORK_BOUNDARY_STATUS &&
          code <= SANDBOX_SETUP_FAILURE_STATUS)
        return 122;
      return code;
    }
    if (WIFSIGNALED(status)) {
      for (size_t index = 0; index < traced_count; ++index) {
        if (traced[index] == stopped) traced[index] = -1;
      }
      if (stopped != child) continue;
      return 128 + WTERMSIG(status);
    }
    if (!WIFSTOPPED(status)) continue;
    int signal = WSTOPSIG(status);
    unsigned int event = (unsigned int)status >> 16;
    if (signal == SIGTRAP &&
        (event == PTRACE_EVENT_FORK || event == PTRACE_EVENT_VFORK ||
         event == PTRACE_EVENT_CLONE)) {
      unsigned long descendant = 0;
      if (ptrace(PTRACE_GETEVENTMSG, stopped, NULL, &descendant) < 0)
        fail("cannot identify sandbox descendant", strerror(errno));
      if (traced_count == MAX_TRACED_PROCESSES)
        fail("sandbox descendant limit exceeded", NULL);
      traced[traced_count++] = (pid_t)descendant;
    }
    if (stopped == child && signal == SIGTRAP && event == PTRACE_EVENT_EXEC)
      child_executed = 1;
    if (signal == (SIGTRAP | 0x80)) {
      struct user_regs_struct registers;
      if (ptrace(PTRACE_GETREGS, stopped, NULL, &registers) < 0)
        fail("cannot inspect sandbox syscall", strerror(errno));
      if ((long long)registers.rax == -ENOSYS) {
        char denied[PATH_MAX];
        if (audit_syscall(stopped, &registers, allowed, allowed_count, denied,
                          sizeof(denied))) {
          fprintf(stderr, "tsfg sandbox: denied path access: %s\n", denied);
          for (size_t index = 0; index < traced_count; ++index) {
            if (traced[index] > 0 && kill(traced[index], SIGKILL) < 0 &&
                errno != ESRCH)
              fail("cannot terminate denied sandbox process", strerror(errno));
          }
          for (;;) {
            if (waitpid(-1, &status, __WALL) >= 0) continue;
            if (errno == EINTR) continue;
            if (errno != ECHILD)
              fail("cannot drain denied sandbox processes", strerror(errno));
            break;
          }
          return SANDBOX_UNDECLARED_INPUT_STATUS;
        }
      }
    }
    int delivered = (signal == SIGTRAP || signal == (SIGTRAP | 0x80) ||
                     signal == SIGSTOP)
                        ? 0
                        : signal;
    if (ptrace(PTRACE_SYSCALL, stopped, NULL, (void *)(long)delivered) < 0 &&
        errno != ESRCH)
      fail("cannot continue sandbox access audit", strerror(errno));
  }
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
      allowed[allowed_count++] = (struct allowed_path){argv[index + 1], access, 0};
    }
    index += 2;
  }
  if (!new_root || !shell || index >= argc || index + 1 >= argc)
    fail("missing sandbox root, shell, or command", NULL);
  char working_directory[PATH_MAX];
  if (!getcwd(working_directory, sizeof(working_directory)))
    fail("cannot read working directory", strerror(errno));
  proc_fd = open("/proc", O_PATH | O_DIRECTORY | O_CLOEXEC);
  if (proc_fd < 0) fail("cannot open process filesystem for access audit", strerror(errno));

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
    bind_path(new_root, &allowed[path_index], allowed[path_index].path);
  struct allowed_path shell_path = {shell, ACCESS_RX, 0};
  struct allowed_path null_path = {"/dev/null", ACCESS_RW, 0};
  bind_path(new_root, &shell_path, "/bin/sh");
  bind_path(new_root, &null_path, "/dev/null");
  pivot_into(new_root, working_directory);
  drop_namespace_capabilities();
  return supervise_command(&argv[index + 1], allowed, allowed_count);
}
