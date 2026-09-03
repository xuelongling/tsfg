// SPDX-License-Identifier: MIT

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <aclapi.h>
#include <userenv.h>

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "userenv.lib")

enum { SANDBOX_SETUP_FAILURE_STATUS = 125 };

enum grant_kind {
  GRANT_READ_ONLY,
  GRANT_READ_EXECUTE,
  GRANT_READ_WRITE,
};

struct requested_grant {
  wchar_t *path;
  enum grant_kind kind;
};

struct applied_grant {
  wchar_t *path;
  PSECURITY_DESCRIPTOR original_descriptor;
  PACL replacement_dacl;
  SECURITY_DESCRIPTOR_CONTROL original_control;
  int applied;
};

struct wide_buffer {
  wchar_t *data;
  size_t length;
  size_t capacity;
};

static void print_win32_error(const wchar_t *operation, DWORD error) {
  wchar_t *message = NULL;
  DWORD flags = FORMAT_MESSAGE_ALLOCATE_BUFFER |
                FORMAT_MESSAGE_FROM_SYSTEM |
                FORMAT_MESSAGE_IGNORE_INSERTS;
  DWORD length = FormatMessageW(flags, NULL, error, 0,
                                (wchar_t *)&message, 0, NULL);
  while (length > 0 &&
         (message[length - 1] == L'\r' || message[length - 1] == L'\n')) {
    message[--length] = L'\0';
  }
  if (length > 0) {
    fwprintf(stderr, L"tsfg windows sandbox: %ls: %ls (%lu)\n",
             operation, message, (unsigned long)error);
  } else {
    fwprintf(stderr, L"tsfg windows sandbox: %ls failed (%lu)\n",
             operation, (unsigned long)error);
  }
  if (message != NULL) LocalFree(message);
}

static void print_hresult_error(const wchar_t *operation, HRESULT result) {
  DWORD error = HRESULT_FACILITY(result) == FACILITY_WIN32
                    ? HRESULT_CODE(result)
                    : (DWORD)result;
  print_win32_error(operation, error);
}

static int checked_add_size(size_t left, size_t right, size_t *result) {
  if (right > SIZE_MAX - left) return 0;
  *result = left + right;
  return 1;
}

static int reserve_wide_buffer(struct wide_buffer *buffer, size_t extra) {
  size_t needed;
  if (!checked_add_size(buffer->length, extra, &needed) ||
      !checked_add_size(needed, 1, &needed)) {
    return 0;
  }
  if (needed <= buffer->capacity) return 1;

  size_t capacity = buffer->capacity == 0 ? 128 : buffer->capacity;
  while (capacity < needed) {
    if (capacity > SIZE_MAX / 2) {
      capacity = needed;
      break;
    }
    capacity *= 2;
  }
  if (capacity > SIZE_MAX / sizeof(wchar_t)) return 0;
  wchar_t *replacement = (wchar_t *)realloc(
      buffer->data, capacity * sizeof(wchar_t));
  if (replacement == NULL) return 0;
  buffer->data = replacement;
  buffer->capacity = capacity;
  return 1;
}

static int append_wide_char(struct wide_buffer *buffer, wchar_t value) {
  if (!reserve_wide_buffer(buffer, 1)) return 0;
  buffer->data[buffer->length++] = value;
  buffer->data[buffer->length] = L'\0';
  return 1;
}

static int append_wide_repeat(struct wide_buffer *buffer, wchar_t value,
                              size_t count) {
  if (!reserve_wide_buffer(buffer, count)) return 0;
  for (size_t index = 0; index < count; ++index) {
    buffer->data[buffer->length++] = value;
  }
  buffer->data[buffer->length] = L'\0';
  return 1;
}

static int append_quoted_backslashes(struct wide_buffer *buffer,
                                     size_t count, size_t suffix) {
  if (count > (SIZE_MAX - suffix) / 2) return 0;
  return append_wide_repeat(buffer, L'\\', count * 2 + suffix);
}

static int append_wide_string(struct wide_buffer *buffer,
                              const wchar_t *value) {
  size_t length = wcslen(value);
  if (!reserve_wide_buffer(buffer, length)) return 0;
  memcpy(buffer->data + buffer->length, value,
         length * sizeof(wchar_t));
  buffer->length += length;
  buffer->data[buffer->length] = L'\0';
  return 1;
}

/* Quote one argv entry according to the CommandLineToArgvW backslash rules. */
static int append_command_argument(struct wide_buffer *buffer,
                                   const wchar_t *argument) {
  int quoted = argument[0] == L'\0' ||
               wcspbrk(argument, L" \t\"") != NULL;
  if (!quoted) return append_wide_string(buffer, argument);
  if (!append_wide_char(buffer, L'\"')) return 0;

  size_t backslashes = 0;
  for (const wchar_t *cursor = argument;; ++cursor) {
    if (*cursor == L'\\') {
      ++backslashes;
      continue;
    }
    if (*cursor == L'\"') {
      if (!append_quoted_backslashes(buffer, backslashes, 1) ||
          !append_wide_char(buffer, L'\"')) {
        return 0;
      }
      backslashes = 0;
      continue;
    }
    if (*cursor == L'\0') {
      if (!append_quoted_backslashes(buffer, backslashes, 0) ||
          !append_wide_char(buffer, L'\"')) {
        return 0;
      }
      return 1;
    }
    if (!append_wide_repeat(buffer, L'\\', backslashes) ||
        !append_wide_char(buffer, *cursor)) {
      return 0;
    }
    backslashes = 0;
  }
}

static wchar_t *build_command_line(int argument_count,
                                   wchar_t **arguments) {
  struct wide_buffer buffer = {0};
  for (int index = 0; index < argument_count; ++index) {
    if (index > 0 && !append_wide_char(&buffer, L' ')) goto failure;
    if (!append_command_argument(&buffer, arguments[index])) goto failure;
  }
  if (buffer.data == NULL) {
    buffer.data = (wchar_t *)calloc(1, sizeof(wchar_t));
  }
  return buffer.data;

failure:
  free(buffer.data);
  return NULL;
}

static wchar_t *absolute_path(const wchar_t *input) {
  DWORD required = GetFullPathNameW(input, 0, NULL, NULL);
  if (required == 0) return NULL;
  wchar_t *result = (wchar_t *)calloc((size_t)required, sizeof(wchar_t));
  if (result == NULL) {
    SetLastError(ERROR_OUTOFMEMORY);
    return NULL;
  }
  DWORD written = GetFullPathNameW(input, required, result, NULL);
  if (written == 0 || written >= required) {
    DWORD error = GetLastError();
    free(result);
    SetLastError(error == ERROR_SUCCESS ? ERROR_INSUFFICIENT_BUFFER : error);
    return NULL;
  }
  return result;
}

static DWORD access_mask(enum grant_kind kind) {
  switch (kind) {
    case GRANT_READ_ONLY:
      return GENERIC_READ;
    case GRANT_READ_EXECUTE:
      return GENERIC_READ | GENERIC_EXECUTE;
    case GRANT_READ_WRITE:
      return GENERIC_READ | GENERIC_WRITE | DELETE;
  }
  return 0;
}

static DWORD apply_grant(const struct requested_grant *requested, PSID sid,
                         struct applied_grant *applied) {
  ZeroMemory(applied, sizeof(*applied));
  applied->path = requested->path;

  PACL original_dacl = NULL;
  DWORD result = GetNamedSecurityInfoW(
      requested->path, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION,
      NULL, NULL, &original_dacl, NULL, &applied->original_descriptor);
  if (result != ERROR_SUCCESS) return result;

  DWORD attributes = GetFileAttributesW(requested->path);
  if (attributes == INVALID_FILE_ATTRIBUTES) return GetLastError();

  DWORD revision = 0;
  if (!GetSecurityDescriptorControl(applied->original_descriptor,
                                    &applied->original_control, &revision)) {
    return GetLastError();
  }

  EXPLICIT_ACCESS_W access;
  ZeroMemory(&access, sizeof(access));
  access.grfAccessPermissions = access_mask(requested->kind);
  access.grfAccessMode = GRANT_ACCESS;
  access.grfInheritance = (attributes & FILE_ATTRIBUTE_DIRECTORY)
                              ? SUB_CONTAINERS_AND_OBJECTS_INHERIT
                              : NO_INHERITANCE;
  access.Trustee.TrusteeForm = TRUSTEE_IS_SID;
  access.Trustee.TrusteeType = TRUSTEE_IS_USER;
  access.Trustee.ptstrName = (LPWSTR)sid;

  result = SetEntriesInAclW(1, &access, original_dacl,
                            &applied->replacement_dacl);
  if (result != ERROR_SUCCESS) return result;

  SECURITY_INFORMATION information = DACL_SECURITY_INFORMATION;
  information |= (applied->original_control & SE_DACL_PROTECTED)
                     ? PROTECTED_DACL_SECURITY_INFORMATION
                     : UNPROTECTED_DACL_SECURITY_INFORMATION;
  result = SetNamedSecurityInfoW(requested->path, SE_FILE_OBJECT,
                                 information, NULL, NULL,
                                 applied->replacement_dacl, NULL);
  if (result == ERROR_SUCCESS) applied->applied = 1;
  return result;
}

static DWORD restore_grant(struct applied_grant *applied) {
  if (!applied->applied) return ERROR_SUCCESS;
  PACL original_dacl = NULL;
  BOOL present = FALSE;
  BOOL defaulted = FALSE;
  if (!GetSecurityDescriptorDacl(applied->original_descriptor, &present,
                                 &original_dacl, &defaulted)) {
    return GetLastError();
  }
  if (!present) return ERROR_INVALID_SECURITY_DESCR;

  SECURITY_INFORMATION information = DACL_SECURITY_INFORMATION;
  information |= (applied->original_control & SE_DACL_PROTECTED)
                     ? PROTECTED_DACL_SECURITY_INFORMATION
                     : UNPROTECTED_DACL_SECURITY_INFORMATION;
  DWORD result = SetNamedSecurityInfoW(applied->path, SE_FILE_OBJECT,
                                       information, NULL, NULL,
                                       original_dacl, NULL);
  if (result == ERROR_SUCCESS) applied->applied = 0;
  return result;
}

static void free_applied_grant(struct applied_grant *applied) {
  if (applied->replacement_dacl != NULL) LocalFree(applied->replacement_dacl);
  if (applied->original_descriptor != NULL) {
    LocalFree(applied->original_descriptor);
  }
  ZeroMemory(applied, sizeof(*applied));
}

static HRESULT create_unique_profile(wchar_t *name, size_t name_count,
                                     PSID *sid) {
  static LONG sequence = 0;
  for (unsigned int attempt = 0; attempt < 16; ++attempt) {
    LONG value = InterlockedIncrement(&sequence);
    int written = _snwprintf_s(
        name, name_count, _TRUNCATE, L"tsfg.sandbox.%lu.%llu.%ld",
        (unsigned long)GetCurrentProcessId(),
        (unsigned long long)GetTickCount64(), (long)value);
    if (written < 0) return E_INVALIDARG;
    HRESULT result = CreateAppContainerProfile(
        name, name, L"Temporary tsfg offline sandbox", NULL, 0, sid);
    if (result != HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS)) return result;
  }
  return HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS);
}

static int parse_arguments(int argc, wchar_t **argv,
                           struct requested_grant **grants,
                           size_t *grant_count, int *command_index) {
  size_t capacity = 0;
  *grants = NULL;
  *grant_count = 0;
  *command_index = -1;

  for (int index = 1; index < argc;) {
    if (wcscmp(argv[index], L"--") == 0) {
      if (index + 1 >= argc) return 0;
      *command_index = index + 1;
      return 1;
    }

    enum grant_kind kind;
    if (wcscmp(argv[index], L"--ro") == 0) {
      kind = GRANT_READ_ONLY;
    } else if (wcscmp(argv[index], L"--rx") == 0) {
      kind = GRANT_READ_EXECUTE;
    } else if (wcscmp(argv[index], L"--rw") == 0) {
      kind = GRANT_READ_WRITE;
    } else {
      return 0;
    }
    if (++index >= argc || argv[index][0] == L'\0') return 0;

    if (*grant_count == capacity) {
      size_t replacement_capacity = capacity == 0 ? 8 : capacity * 2;
      if (replacement_capacity < capacity ||
          replacement_capacity > SIZE_MAX / sizeof(**grants)) {
        return 0;
      }
      struct requested_grant *replacement =
          (struct requested_grant *)realloc(
              *grants, replacement_capacity * sizeof(**grants));
      if (replacement == NULL) return 0;
      *grants = replacement;
      capacity = replacement_capacity;
    }
    wchar_t *normalized = absolute_path(argv[index]);
    if (normalized == NULL) return 0;
    (*grants)[*grant_count].path = normalized;
    (*grants)[*grant_count].kind = kind;
    ++*grant_count;
    ++index;
  }
  return 0;
}

static void free_requested_grants(struct requested_grant *grants,
                                  size_t grant_count) {
  if (grants == NULL) return;
  for (size_t index = 0; index < grant_count; ++index) {
    free(grants[index].path);
  }
  free(grants);
}

int wmain(int argc, wchar_t **argv) {
  int status = SANDBOX_SETUP_FAILURE_STATUS;
  int command_index = -1;
  struct requested_grant *requested = NULL;
  size_t requested_count = 0;
  struct applied_grant *applied = NULL;
  size_t applied_count = 0;
  wchar_t *command_path = NULL;
  wchar_t *command_line = NULL;
  wchar_t profile_name[128] = {0};
  PSID app_container_sid = NULL;
  int profile_created = 0;
  PPROC_THREAD_ATTRIBUTE_LIST attributes = NULL;
  int attributes_initialized = 0;
  STARTUPINFOEXW startup;
  PROCESS_INFORMATION process;
  HANDLE job = NULL;
  int child_started = 0;
  int child_complete = 0;
  int cleanup_failed = 0;

  ZeroMemory(&startup, sizeof(startup));
  ZeroMemory(&process, sizeof(process));

  if (!parse_arguments(argc, argv, &requested, &requested_count,
                       &command_index)) {
    fwprintf(stderr,
             L"usage: windows-sandbox-run [--ro PATH] [--rx PATH] "
             L"[--rw PATH] -- COMMAND [ARG ...]\n");
    goto cleanup;
  }

  command_path = absolute_path(argv[command_index]);
  DWORD command_error = ERROR_SUCCESS;
  if (command_path == NULL) {
    command_error = GetLastError();
  } else {
    DWORD command_attributes = GetFileAttributesW(command_path);
    if (command_attributes == INVALID_FILE_ATTRIBUTES) {
      command_error = GetLastError();
    } else if (command_attributes & FILE_ATTRIBUTE_DIRECTORY) {
      command_error = ERROR_FILE_NOT_FOUND;
    }
  }
  if (command_error != ERROR_SUCCESS) {
    print_win32_error(L"resolve command", command_error);
    goto cleanup;
  }
  argv[command_index] = command_path;
  command_line = build_command_line(argc - command_index,
                                    argv + command_index);
  if (command_line == NULL) {
    print_win32_error(L"build command line", ERROR_OUTOFMEMORY);
    goto cleanup;
  }

  HRESULT profile_result = create_unique_profile(
      profile_name, sizeof(profile_name) / sizeof(profile_name[0]),
      &app_container_sid);
  if (FAILED(profile_result)) {
    print_hresult_error(L"create AppContainer profile", profile_result);
    goto cleanup;
  }
  profile_created = 1;
  if (app_container_sid == NULL || !IsValidSid(app_container_sid)) {
    print_win32_error(L"validate AppContainer SID", ERROR_INVALID_SID);
    goto cleanup;
  }

  /* The executable always receives RX even if the caller omitted it. */
  struct requested_grant command_grant = {
      command_path, GRANT_READ_EXECUTE};
  if (requested_count == SIZE_MAX ||
      requested_count + 1 > SIZE_MAX / sizeof(*applied)) {
    print_win32_error(L"allocate ACL rollback state", ERROR_OUTOFMEMORY);
    goto cleanup;
  }
  applied = (struct applied_grant *)calloc(requested_count + 1,
                                            sizeof(*applied));
  if (applied == NULL) {
    print_win32_error(L"allocate ACL rollback state", ERROR_OUTOFMEMORY);
    goto cleanup;
  }

  for (size_t index = 0; index < requested_count; ++index) {
    DWORD result = apply_grant(&requested[index], app_container_sid,
                               &applied[applied_count]);
    if (result != ERROR_SUCCESS) {
      print_win32_error(L"grant AppContainer path access", result);
      goto cleanup;
    }
    ++applied_count;
  }
  {
    DWORD result = apply_grant(&command_grant, app_container_sid,
                               &applied[applied_count]);
    if (result != ERROR_SUCCESS) {
      print_win32_error(L"grant AppContainer command access", result);
      goto cleanup;
    }
    ++applied_count;
  }

  SIZE_T attribute_size = 0;
  InitializeProcThreadAttributeList(NULL, 1, 0, &attribute_size);
  if (attribute_size == 0 && GetLastError() != ERROR_INSUFFICIENT_BUFFER) {
    print_win32_error(L"size process attribute list", GetLastError());
    goto cleanup;
  }
  attributes = (PPROC_THREAD_ATTRIBUTE_LIST)HeapAlloc(
      GetProcessHeap(), HEAP_ZERO_MEMORY, attribute_size);
  if (attributes == NULL) {
    print_win32_error(L"allocate process attribute list", ERROR_OUTOFMEMORY);
    goto cleanup;
  }
  if (!InitializeProcThreadAttributeList(attributes, 1, 0,
                                         &attribute_size)) {
    print_win32_error(L"initialize process attribute list", GetLastError());
    goto cleanup;
  }
  attributes_initialized = 1;

  SECURITY_CAPABILITIES capabilities;
  ZeroMemory(&capabilities, sizeof(capabilities));
  capabilities.AppContainerSid = app_container_sid;
  capabilities.CapabilityCount = 0;
  capabilities.Capabilities = NULL;
  if (!UpdateProcThreadAttribute(
          attributes, 0, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
          &capabilities, sizeof(capabilities), NULL, NULL)) {
    print_win32_error(L"set AppContainer security capabilities",
                      GetLastError());
    goto cleanup;
  }

  startup.StartupInfo.cb = sizeof(startup);
  startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
  startup.StartupInfo.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
  startup.StartupInfo.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
  startup.StartupInfo.hStdError = GetStdHandle(STD_ERROR_HANDLE);
  startup.lpAttributeList = attributes;

  job = CreateJobObjectW(NULL, NULL);
  if (job == NULL) {
    print_win32_error(L"create process job", GetLastError());
    goto cleanup;
  }
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION job_limits;
  ZeroMemory(&job_limits, sizeof(job_limits));
  job_limits.BasicLimitInformation.LimitFlags =
      JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation,
                               &job_limits, sizeof(job_limits))) {
    print_win32_error(L"configure process job", GetLastError());
    goto cleanup;
  }

  if (!CreateProcessW(command_path, command_line, NULL, NULL, TRUE,
                      EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT |
                          CREATE_SUSPENDED,
                      NULL, NULL, &startup.StartupInfo, &process)) {
    print_win32_error(L"create AppContainer process", GetLastError());
    goto cleanup;
  }
  child_started = 1;
  if (!AssignProcessToJobObject(job, process.hProcess)) {
    print_win32_error(L"assign AppContainer process to job", GetLastError());
    goto cleanup;
  }
  if (ResumeThread(process.hThread) == (DWORD)-1) {
    print_win32_error(L"resume AppContainer process", GetLastError());
    goto cleanup;
  }
  CloseHandle(process.hThread);
  process.hThread = NULL;

  DWORD wait_result = WaitForSingleObject(process.hProcess, INFINITE);
  if (wait_result != WAIT_OBJECT_0) {
    print_win32_error(L"wait for AppContainer process",
                      wait_result == WAIT_FAILED ? GetLastError()
                                                 : ERROR_GEN_FAILURE);
    goto cleanup;
  }
  DWORD child_status = 0;
  if (!GetExitCodeProcess(process.hProcess, &child_status) ||
      child_status == STILL_ACTIVE) {
    print_win32_error(L"read AppContainer process status", GetLastError());
    goto cleanup;
  }
  child_complete = 1;
  status = (int)child_status;

cleanup:
  if (child_started && !child_complete && process.hProcess != NULL) {
    if (!TerminateProcess(process.hProcess, SANDBOX_SETUP_FAILURE_STATUS)) {
      print_win32_error(L"terminate incomplete AppContainer process",
                        GetLastError());
      cleanup_failed = 1;
    } else if (WaitForSingleObject(process.hProcess, INFINITE) != WAIT_OBJECT_0) {
      print_win32_error(L"wait for terminated AppContainer process",
                        GetLastError());
      cleanup_failed = 1;
    }
  }
  if (process.hThread != NULL) CloseHandle(process.hThread);
  if (process.hProcess != NULL) CloseHandle(process.hProcess);
  if (job != NULL) CloseHandle(job);
  if (attributes != NULL) {
    if (attributes_initialized) DeleteProcThreadAttributeList(attributes);
    HeapFree(GetProcessHeap(), 0, attributes);
  }

  while (applied_count > 0) {
    --applied_count;
    DWORD result = ERROR_GEN_FAILURE;
    for (int attempt = 0; attempt < 3; ++attempt) {
      result = restore_grant(&applied[applied_count]);
      if (result == ERROR_SUCCESS) break;
      Sleep(10);
    }
    if (result != ERROR_SUCCESS) {
      print_win32_error(L"restore path ACL", result);
      cleanup_failed = 1;
    }
  }
  if (applied != NULL) {
    for (size_t index = 0; index < requested_count + 1; ++index) {
      free_applied_grant(&applied[index]);
    }
    free(applied);
  }

  if (profile_created) {
    HRESULT result = E_FAIL;
    for (int attempt = 0; attempt < 3; ++attempt) {
      result = DeleteAppContainerProfile(profile_name);
      if (SUCCEEDED(result)) break;
      Sleep(10);
    }
    if (FAILED(result)) {
      print_hresult_error(L"delete AppContainer profile", result);
      cleanup_failed = 1;
    }
  }
  if (app_container_sid != NULL) FreeSid(app_container_sid);
  free(command_line);
  free(command_path);
  free_requested_grants(requested, requested_count);

  if (cleanup_failed) return SANDBOX_SETUP_FAILURE_STATUS;
  return status;
}
