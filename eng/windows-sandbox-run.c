// SPDX-License-Identifier: MIT

#define WIN32_LEAN_AND_MEAN
#define _WIN32_WINNT 0x0A00
#include <windows.h>
#include <aclapi.h>
#include <fwpmu.h>
#include <objbase.h>
#include <sddl.h>

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "fwpuclnt.lib")
#pragma comment(lib, "ole32.lib")

enum {
  SANDBOX_NETWORK_BOUNDARY_STATUS = 123,
  SANDBOX_UNDECLARED_INPUT_STATUS = 124,
  SANDBOX_SETUP_FAILURE_STATUS = 125,
};

enum grant_kind {
  GRANT_READ_ONLY,
  GRANT_READ_EXECUTE,
  GRANT_READ_WRITE,
  GRANT_DENY_READ,
};

struct requested_grant {
  wchar_t *path;
  enum grant_kind kind;
};

struct applied_grant {
  wchar_t *path;
  PSECURITY_DESCRIPTOR original_descriptor;
  PSECURITY_DESCRIPTOR original_label_descriptor;
  PSECURITY_DESCRIPTOR low_label_descriptor;
  PACL original_label_sacl;
  PACL low_label_sacl;
  PACL replacement_dacl;
  SECURITY_DESCRIPTOR_CONTROL original_control;
  int applied;
};

struct path_list {
  wchar_t **items;
  size_t count;
  size_t capacity;
};

struct wide_buffer {
  wchar_t *data;
  size_t length;
  size_t capacity;
};

/* This mode is deliberately opt-in: legacy R00 grants retain their semantics. */
static wchar_t *allowlisted_root = NULL;
static HANDLE *pinned_paths = NULL;
static size_t pinned_count = 0;

static int e_absolute(const wchar_t *path) {
  return path != NULL && wcslen(path) > 3 &&
      (path[0] == L'E' || path[0] == L'e') && path[1] == L':' &&
      path[2] == L'\\' && wcschr(path + 2, L':') == NULL;
}

static int beneath(const wchar_t *root, const wchar_t *path) {
  size_t length = wcslen(root);
  return _wcsnicmp(root, path, length) == 0 &&
      (path[length] == L'\\' || path[length] == L'\0');
}

/* Hold non-delete-shared handles until ACL restoration, rejecting aliases. */
static DWORD pin_path(const wchar_t *path, int recurse) {
  HANDLE file = CreateFileW(path, READ_CONTROL | FILE_READ_ATTRIBUTES,
      FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, NULL);
  if (file == INVALID_HANDLE_VALUE) return GetLastError();
  BY_HANDLE_FILE_INFORMATION info;
  wchar_t *final_path = calloc(32768, sizeof(wchar_t));
  if (final_path == NULL) { CloseHandle(file); return ERROR_OUTOFMEMORY; }
  DWORD length = GetFinalPathNameByHandleW(file, final_path, 32768,
                                         FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
  DWORD result = ERROR_ACCESS_DENIED;
  if (!GetFileInformationByHandle(file, &info) || length == 0 || length >= 32768)
    goto failed;
  if ((info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) ||
      (!(info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) && info.nNumberOfLinks != 1) ||
      wcsncmp(final_path, L"\\\\?\\", 4) != 0 ||
      !e_absolute(final_path + 4) || _wcsicmp(path, final_path + 4) != 0)
    goto failed;
  free(final_path);
  final_path = NULL;
  HANDLE *replacement = realloc(pinned_paths, (pinned_count + 1) * sizeof(HANDLE));
  if (replacement == NULL) { result = ERROR_OUTOFMEMORY; goto failed; }
  pinned_paths = replacement;
  pinned_paths[pinned_count++] = file;
  if (recurse && (info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)) {
    size_t size = wcslen(path) + 4;
    wchar_t *pattern = calloc(size, sizeof(wchar_t));
    if (!pattern) return ERROR_OUTOFMEMORY;
    swprintf(pattern, size, L"%ls\\*", path);
    WIN32_FIND_DATAW entry;
    HANDLE search = FindFirstFileW(pattern, &entry);
    free(pattern);
    if (search == INVALID_HANDLE_VALUE) return GetLastError();
    result = ERROR_SUCCESS;
    do {
      if (!wcscmp(entry.cFileName, L".") || !wcscmp(entry.cFileName, L"..")) continue;
      size = wcslen(path) + wcslen(entry.cFileName) + 2;
      wchar_t *child = calloc(size, sizeof(wchar_t));
      if (!child) { result = ERROR_OUTOFMEMORY; break; }
      swprintf(child, size, L"%ls\\%ls", path, entry.cFileName);
      result = pin_path(child, 1);
      free(child);
      if (result != ERROR_SUCCESS) break;
    } while (FindNextFileW(search, &entry));
    if (result == ERROR_SUCCESS && GetLastError() != ERROR_NO_MORE_FILES)
      result = GetLastError();
    FindClose(search);
    return result;
  }
  return ERROR_SUCCESS;
failed:
  free(final_path);
  CloseHandle(file);
  return result;
}

static void *token_information(HANDLE token, TOKEN_INFORMATION_CLASS kind) {
  DWORD size = 0;
  GetTokenInformation(token, kind, NULL, 0, &size);
  if (size == 0) return NULL;
  void *value = calloc(1, size);
  if (value && GetTokenInformation(token, kind, value, size, &size)) return value;
  free(value);
  return NULL;
}

/* Read-only attestation of this process. This does not attest a WFP boundary. */
static int verify_restriction(void) {
  HANDLE token = NULL;
  BOOL in_job = FALSE;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) return 125;
  TOKEN_GROUPS *restricting = token_information(token, TokenRestrictedSids);
  TOKEN_GROUPS *groups = token_information(token, TokenGroups);
  TOKEN_MANDATORY_LABEL *label = token_information(token, TokenIntegrityLevel);
  TOKEN_USER *user = token_information(token, TokenUser);
  TOKEN_PRIVILEGES *privileges = token_information(token, TokenPrivileges);
  int valid = restricting && groups && label && user && privileges &&
      restricting->GroupCount == 1 &&
      IsProcessInJob(GetCurrentProcess(), NULL, &in_job) && in_job;
  LPWSTR sid = NULL, user_sid = NULL;
  if (valid) {
    PSID identity = restricting->Groups[0].Sid;
    valid = ConvertSidToStringSidW(identity, &sid) &&
        wcsncmp(sid, L"S-1-5-21-", 9) == 0 &&
        *GetSidSubAuthorityCount(identity) == 5 &&
        *GetSidSubAuthority(identity, 4) == 0x54534647 &&
        !EqualSid(identity, user->User.Sid) &&
        *GetSidSubAuthority(label->Label.Sid,
            *GetSidSubAuthorityCount(label->Label.Sid) - 1) == SECURITY_MANDATORY_LOW_RID;
    for (DWORD i = 0; valid && i < groups->GroupCount; ++i) {
      if (IsWellKnownSid(groups->Groups[i].Sid, WinBuiltinAdministratorsSid) &&
          !(groups->Groups[i].Attributes & SE_GROUP_USE_FOR_DENY_ONLY)) valid = 0;
    }
    LUID traverse;
    if (!LookupPrivilegeValueW(NULL, SE_CHANGE_NOTIFY_NAME, &traverse)) valid = 0;
    for (DWORD i = 0; valid && i < privileges->PrivilegeCount; ++i) {
      LUID current = privileges->Privileges[i].Luid;
      if (current.LowPart != traverse.LowPart || current.HighPart != traverse.HighPart)
        valid = 0;
    }
  }
  if (valid && ConvertSidToStringSidW(user->User.Sid, &user_sid)) {
    wprintf(L"{\"schemaVersion\":1,\"restrictionSid\":\"%ls\",\"userSid\":\"%ls\","
            L"\"integrity\":\"low\",\"administratorDenyOnly\":true,"
            L"\"inJob\":true,\"wfpAttested\":false}\n", sid, user_sid);
  } else valid = 0;
  LocalFree(sid); LocalFree(user_sid);
  free(restricting); free(groups); free(label); free(user); free(privileges);
  CloseHandle(token);
  if (!valid) fwprintf(stderr, L"tsfg windows sandbox: restriction verification failed\n");
  return valid ? 0 : 125;
}

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

static int checked_add_size(size_t left, size_t right, size_t *result) {
  if (right > SIZE_MAX - left) return 0;
  *result = left + right;
  return 1;
}

static int reserve_wide_buffer(struct wide_buffer *buffer, size_t extra) {
  size_t needed;
  if (!checked_add_size(buffer->length, extra, &needed) ||
      !checked_add_size(needed, 1, &needed)) return 0;
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
  memcpy(buffer->data + buffer->length, value, length * sizeof(wchar_t));
  buffer->length += length;
  buffer->data[buffer->length] = L'\0';
  return 1;
}

static int append_command_argument(struct wide_buffer *buffer,
                                   const wchar_t *argument) {
  int quoted = argument[0] == L'\0' || wcspbrk(argument, L" \t\"") != NULL;
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
          !append_wide_char(buffer, L'\"')) return 0;
      backslashes = 0;
      continue;
    }
    if (*cursor == L'\0') {
      if (!append_quoted_backslashes(buffer, backslashes, 0) ||
          !append_wide_char(buffer, L'\"')) return 0;
      return 1;
    }
    if (!append_wide_repeat(buffer, L'\\', backslashes) ||
        !append_wide_char(buffer, *cursor)) return 0;
    backslashes = 0;
  }
}

static wchar_t *build_command_line(int argument_count, wchar_t **arguments) {
  struct wide_buffer buffer = {0};
  for (int index = 0; index < argument_count; ++index) {
    if (index > 0 && !append_wide_char(&buffer, L' ')) goto failure;
    if (!append_command_argument(&buffer, arguments[index])) goto failure;
  }
  if (buffer.data == NULL) buffer.data = (wchar_t *)calloc(1, sizeof(wchar_t));
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

static int append_path(struct path_list *list, const wchar_t *input) {
  if (list->count == list->capacity) {
    size_t capacity = list->capacity == 0 ? 8 : list->capacity * 2;
    if (capacity < list->capacity || capacity > SIZE_MAX / sizeof(*list->items)) {
      SetLastError(ERROR_OUTOFMEMORY);
      return 0;
    }
    wchar_t **replacement = (wchar_t **)realloc(
        list->items, capacity * sizeof(*list->items));
    if (replacement == NULL) {
      SetLastError(ERROR_OUTOFMEMORY);
      return 0;
    }
    list->items = replacement;
    list->capacity = capacity;
  }
  wchar_t *normalized = absolute_path(input);
  if (normalized == NULL) return 0;
  list->items[list->count++] = normalized;
  return 1;
}

static void free_paths(struct path_list *list) {
  for (size_t index = 0; index < list->count; ++index) free(list->items[index]);
  free(list->items);
  ZeroMemory(list, sizeof(*list));
}

static DWORD access_mask(enum grant_kind kind) {
  if (allowlisted_root != NULL) {
    switch (kind) {
      case GRANT_READ_ONLY: return FILE_GENERIC_READ;
      case GRANT_READ_EXECUTE: return FILE_GENERIC_READ | FILE_GENERIC_EXECUTE;
      case GRANT_READ_WRITE: return FILE_GENERIC_READ | FILE_GENERIC_WRITE | DELETE;
      case GRANT_DENY_READ: return FILE_GENERIC_READ | FILE_GENERIC_EXECUTE;
    }
  }
  switch (kind) {
    case GRANT_READ_ONLY: return GENERIC_READ | GENERIC_EXECUTE;
    case GRANT_READ_EXECUTE: return GENERIC_READ | GENERIC_EXECUTE;
    case GRANT_READ_WRITE:
      return GENERIC_READ | GENERIC_WRITE | GENERIC_EXECUTE | DELETE;
    case GRANT_DENY_READ: return GENERIC_READ | GENERIC_EXECUTE;
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
  EXPLICIT_ACCESS_W entries[2];
  ZeroMemory(entries, sizeof(entries));
  EXPLICIT_ACCESS_W *access = &entries[0];
  DWORD inheritance = (attributes & FILE_ATTRIBUTE_DIRECTORY)
                          ? SUB_CONTAINERS_AND_OBJECTS_INHERIT
                          : NO_INHERITANCE;
  access->grfAccessPermissions = access_mask(requested->kind);
  access->grfAccessMode = requested->kind == GRANT_DENY_READ
                             ? DENY_ACCESS
                             : GRANT_ACCESS;
  access->grfInheritance = inheritance;
  access->Trustee.TrusteeForm = TRUSTEE_IS_SID;
  access->Trustee.TrusteeType = TRUSTEE_IS_USER;
  access->Trustee.ptstrName = (LPWSTR)sid;
  PSID owner_rights = NULL;
  if (allowlisted_root) {
    /* Suppress implicit owner WRITE_DAC on staged and newly created files.
       The supervisor retains its ordinary user ACE for rollback. */
    if (!ConvertStringSidToSidW(L"S-1-3-4", &owner_rights)) return GetLastError();
    entries[1] = entries[0];
    entries[1].grfAccessPermissions = READ_CONTROL;
    entries[1].grfAccessMode = SET_ACCESS;
    entries[1].Trustee.ptstrName = (LPWSTR)owner_rights;
  }
  result = SetEntriesInAclW(allowlisted_root ? 2 : 1, entries, original_dacl,
                            &applied->replacement_dacl);
  LocalFree(owner_rights);
  if (result != ERROR_SUCCESS) return result;
  SECURITY_INFORMATION information = DACL_SECURITY_INFORMATION;
  information |= (applied->original_control & SE_DACL_PROTECTED)
                     ? PROTECTED_DACL_SECURITY_INFORMATION
                     : UNPROTECTED_DACL_SECURITY_INFORMATION;
  if (requested->kind == GRANT_READ_WRITE) {
    result = GetNamedSecurityInfoW(
        requested->path, SE_FILE_OBJECT, LABEL_SECURITY_INFORMATION,
        NULL, NULL, NULL, &applied->original_label_sacl,
        &applied->original_label_descriptor);
    if (result != ERROR_SUCCESS) return result;
    const wchar_t *low_label = (attributes & FILE_ATTRIBUTE_DIRECTORY)
                                   ? L"S:(ML;OICI;NW;;;LW)"
                                   : L"S:(ML;;NW;;;LW)";
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
            low_label, SDDL_REVISION_1, &applied->low_label_descriptor,
            NULL)) return GetLastError();
    BOOL present = FALSE;
    BOOL defaulted = FALSE;
    if (!GetSecurityDescriptorSacl(applied->low_label_descriptor, &present,
                                   &applied->low_label_sacl, &defaulted)) {
      return GetLastError();
    }
    if (!present || applied->low_label_sacl == NULL) {
      return ERROR_INVALID_SECURITY_DESCR;
    }
    information |= LABEL_SECURITY_INFORMATION;
  }
  result = SetNamedSecurityInfoW(requested->path, SE_FILE_OBJECT,
                                 information, NULL, NULL,
                                 applied->replacement_dacl,
                                 applied->low_label_sacl);
  if (result == ERROR_SUCCESS) applied->applied = 1;
  return result;
}

static DWORD restore_grant(struct applied_grant *applied) {
  if (!applied->applied) return ERROR_SUCCESS;
  PACL original_dacl = NULL;
  BOOL present = FALSE;
  BOOL defaulted = FALSE;
  if (!GetSecurityDescriptorDacl(applied->original_descriptor, &present,
                                 &original_dacl, &defaulted)) return GetLastError();
  if (!present) return ERROR_INVALID_SECURITY_DESCR;
  SECURITY_INFORMATION information = DACL_SECURITY_INFORMATION;
  information |= (applied->original_control & SE_DACL_PROTECTED)
                     ? PROTECTED_DACL_SECURITY_INFORMATION
                     : UNPROTECTED_DACL_SECURITY_INFORMATION;
  if (applied->original_label_descriptor != NULL) {
    information |= LABEL_SECURITY_INFORMATION;
  }
  DWORD result = SetNamedSecurityInfoW(
      applied->path, SE_FILE_OBJECT, information, NULL, NULL,
      original_dacl, applied->original_label_sacl);
  if (result == ERROR_SUCCESS) applied->applied = 0;
  return result;
}

static void free_applied_grant(struct applied_grant *applied) {
  if (applied->replacement_dacl != NULL) LocalFree(applied->replacement_dacl);
  if (applied->low_label_descriptor != NULL) {
    LocalFree(applied->low_label_descriptor);
  }
  if (applied->original_label_descriptor != NULL) {
    LocalFree(applied->original_label_descriptor);
  }
  if (applied->original_descriptor != NULL) LocalFree(applied->original_descriptor);
  ZeroMemory(applied, sizeof(*applied));
}

static DWORD add_app_filter(HANDLE engine, const GUID *sublayer,
                            const GUID *layer, const wchar_t *program) {
  FWP_BYTE_BLOB *app_id = NULL;
  DWORD result = FwpmGetAppIdFromFileName0(program, &app_id);
  if (result != ERROR_SUCCESS) return result;
  FWPM_FILTER_CONDITION0 condition;
  ZeroMemory(&condition, sizeof(condition));
  condition.fieldKey = FWPM_CONDITION_ALE_APP_ID;
  condition.matchType = FWP_MATCH_EQUAL;
  condition.conditionValue.type = FWP_BYTE_BLOB_TYPE;
  condition.conditionValue.byteBlob = app_id;
  UINT8 weight = 15;
  FWPM_FILTER0 filter;
  ZeroMemory(&filter, sizeof(filter));
  filter.displayData.name = L"tsfg offline executable block";
  filter.layerKey = *layer;
  filter.subLayerKey = *sublayer;
  filter.weight.type = FWP_UINT8;
  filter.weight.uint8 = weight;
  filter.numFilterConditions = 1;
  filter.filterCondition = &condition;
  filter.action.type = FWP_ACTION_BLOCK;
  result = FwpmFilterAdd0(engine, &filter, NULL, NULL);
  FwpmFreeMemory0((void **)&app_id);
  return result;
}

static DWORD establish_network_boundary(const struct path_list *programs,
                                        HANDLE *engine) {
  FWPM_SESSION0 session;
  ZeroMemory(&session, sizeof(session));
  session.displayData.name = L"tsfg offline dynamic session";
  session.flags = FWPM_SESSION_FLAG_DYNAMIC;
  DWORD result = FwpmEngineOpen0(NULL, RPC_C_AUTHN_WINNT, NULL, &session, engine);
  if (result != ERROR_SUCCESS) return result;
  GUID sublayer_key;
  HRESULT guid_result = CoCreateGuid(&sublayer_key);
  if (FAILED(guid_result)) return (DWORD)guid_result;
  FWPM_SUBLAYER0 sublayer;
  ZeroMemory(&sublayer, sizeof(sublayer));
  sublayer.subLayerKey = sublayer_key;
  sublayer.displayData.name = L"tsfg offline dynamic sublayer";
  sublayer.weight = 0xffff;
  result = FwpmSubLayerAdd0(*engine, &sublayer, NULL);
  if (result != ERROR_SUCCESS) return result;
  result = FwpmTransactionBegin0(*engine, 0);
  if (result != ERROR_SUCCESS) return result;
  for (size_t index = 0; index < programs->count && result == ERROR_SUCCESS; ++index) {
    result = add_app_filter(*engine, &sublayer_key,
                            &FWPM_LAYER_ALE_AUTH_CONNECT_V4,
                            programs->items[index]);
    if (result == ERROR_SUCCESS) {
      result = add_app_filter(*engine, &sublayer_key,
                              &FWPM_LAYER_ALE_AUTH_CONNECT_V6,
                              programs->items[index]);
    }
  }
  if (result == ERROR_SUCCESS) result = FwpmTransactionCommit0(*engine);
  else FwpmTransactionAbort0(*engine);
  return result;
}

static int parse_arguments(int argc, wchar_t **argv,
                           struct requested_grant **grants,
                           size_t *grant_count,
                           struct path_list *programs,
                           int *network_only,
                           DWORD *boundary_status,
                           int *command_index) {
  size_t capacity = 0;
  *grants = NULL;
  *grant_count = 0;
  *network_only = 0;
  *boundary_status = 0;
  *command_index = -1;
  for (int index = 1; index < argc;) {
    if (wcscmp(argv[index], L"--allowlisted-root") == 0) {
      if (++index >= argc || allowlisted_root != NULL) return 0;
      allowlisted_root = _wcsdup(argv[index++]);
      if (!allowlisted_root) return 0;
      continue;
    }
    if (wcscmp(argv[index], L"--") == 0) {
      if (index + 1 >= argc) return 0;
      *command_index = index + 1;
      return 1;
    }
    if (wcscmp(argv[index], L"--network-only") == 0) {
      *network_only = 1;
      ++index;
      continue;
    }
    if (wcscmp(argv[index], L"--deny-network") == 0) {
      if (++index >= argc || !append_path(programs, argv[index])) return 0;
      ++index;
      continue;
    }
    if (wcscmp(argv[index], L"--allow-boundary-status") == 0) {
      if (++index >= argc) return 0;
      wchar_t *end = NULL;
      unsigned long value = wcstoul(argv[index], &end, 10);
      if (*argv[index] == L'\0' || *end != L'\0' ||
          (value != 123 && value != 124)) return 0;
      *boundary_status = (DWORD)value;
      ++index;
      continue;
    }
    enum grant_kind kind;
    if (wcscmp(argv[index], L"--ro") == 0) kind = GRANT_READ_ONLY;
    else if (wcscmp(argv[index], L"--rx") == 0) kind = GRANT_READ_EXECUTE;
    else if (wcscmp(argv[index], L"--rw") == 0) kind = GRANT_READ_WRITE;
    else if (wcscmp(argv[index], L"--deny-read") == 0) kind = GRANT_DENY_READ;
    else return 0;
    if (++index >= argc || argv[index][0] == L'\0') return 0;
    if (*grant_count == capacity) {
      size_t replacement_capacity = capacity == 0 ? 8 : capacity * 2;
      if (replacement_capacity < capacity ||
          replacement_capacity > SIZE_MAX / sizeof(**grants)) return 0;
      struct requested_grant *replacement = (struct requested_grant *)realloc(
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
  for (size_t index = 0; index < grant_count; ++index) free(grants[index].path);
  free(grants);
}

int wmain(int argc, wchar_t **argv) {
  if (argc == 2 && wcscmp(argv[1], L"--verify-restriction") == 0)
    return verify_restriction();
  int status = SANDBOX_SETUP_FAILURE_STATUS;
  int command_index = -1;
  int network_only = 0;
  DWORD boundary_status = 0;
  struct requested_grant *requested = NULL;
  size_t requested_count = 0;
  struct applied_grant *applied = NULL;
  size_t applied_count = 0;
  struct path_list programs = {0};
  wchar_t *command_path = NULL;
  wchar_t *command_line = NULL;
  HANDLE process_token = NULL;
  HANDLE restricted_token = NULL;
  TOKEN_USER *token_user = NULL;
  PSID unique_sid = NULL;
  TOKEN_GROUPS *token_groups = NULL;
  SID_AND_ATTRIBUTES *disabled_groups = NULL;
  DWORD disabled_count = 0;
  BYTE low_integrity_sid_buffer[SECURITY_MAX_SID_SIZE];
  DWORD low_integrity_sid_size = sizeof(low_integrity_sid_buffer);
  PSID low_integrity_sid = (PSID)low_integrity_sid_buffer;
  HANDLE filter_engine = NULL;
  HANDLE acl_mutex = NULL;
  int acl_mutex_owned = 0;
  PROCESS_INFORMATION process;
  STARTUPINFOW startup;
  STARTUPINFOEXW extended_startup;
  HANDLE inherited[3] = {NULL, NULL, NULL};
  SIZE_T attribute_size = 0;
  HANDLE job = NULL;
  int child_started = 0;
  int child_complete = 0;
  int cleanup_failed = 0;
  ZeroMemory(&process, sizeof(process));
  ZeroMemory(&startup, sizeof(startup));
  ZeroMemory(&extended_startup, sizeof(extended_startup));

  if (!parse_arguments(argc, argv, &requested, &requested_count,
                       &programs, &network_only, &boundary_status,
                       &command_index)) {
    fwprintf(stderr,
             L"usage: windows-sandbox-run [--network-only] "
             L"[--deny-network PATH] [--allow-boundary-status 123|124] "
             L"[--ro PATH] [--rx PATH] "
             L"[--rw PATH] [--deny-read PATH] -- COMMAND [ARG ...]\n");
    goto cleanup;
  }
  if (allowlisted_root != NULL) {
    DWORD validation = ERROR_ACCESS_DENIED;
    if (e_absolute(allowlisted_root) && !network_only)
      validation = pin_path(allowlisted_root, 1);
    if (validation != ERROR_SUCCESS) {
      print_win32_error(L"validate allowlisted root", validation);
      goto cleanup;
    }
    HANDLE owner_token = NULL;
    TOKEN_USER *caller = NULL;
    PSID owner = NULL;
    PSECURITY_DESCRIPTOR descriptor = NULL;
    if (OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &owner_token))
      caller = token_information(owner_token, TokenUser);
    DWORD owner_result = GetNamedSecurityInfoW(allowlisted_root, SE_FILE_OBJECT,
        OWNER_SECURITY_INFORMATION, &owner, NULL, NULL, NULL, &descriptor);
    int owned = caller && owner_result == ERROR_SUCCESS && EqualSid(owner, caller->User.Sid);
    LocalFree(descriptor);
    free(caller);
    if (owner_token) CloseHandle(owner_token);
    if (!owned) {
      print_win32_error(L"validate allowlisted root owner", ERROR_ACCESS_DENIED);
      goto cleanup;
    }
    for (size_t index = 0; index < requested_count; ++index) {
      if (!beneath(allowlisted_root, requested[index].path) ||
          _wcsicmp(allowlisted_root, requested[index].path) == 0) {
        print_win32_error(L"validate allowlisted grant", ERROR_ACCESS_DENIED);
        goto cleanup;
      }
      for (size_t previous = 0; previous < index; ++previous) {
        if (beneath(requested[previous].path, requested[index].path) ||
            beneath(requested[index].path, requested[previous].path)) {
          print_win32_error(L"validate overlapping allowlisted grants", ERROR_ACCESS_DENIED);
          goto cleanup;
        }
      }
    }
    const wchar_t *variables[] = {L"TEMP", L"TMP", L"USERPROFILE", L"HOME",
                                  L"APPDATA", L"LOCALAPPDATA"};
    for (size_t i = 0; i < sizeof(variables) / sizeof(*variables); ++i) {
      wchar_t value[32768];
      DWORD length = GetEnvironmentVariableW(variables[i], value, 32768);
      if (!length || length >= 32768 || !e_absolute(value) ||
          !beneath(allowlisted_root, value)) {
        print_win32_error(L"validate allowlisted environment", ERROR_ACCESS_DENIED);
        goto cleanup;
      }
    }
  }
  if (network_only && requested_count != 0) {
    fwprintf(stderr, L"tsfg windows sandbox: --network-only cannot use path grants\n");
    goto cleanup;
  }
  command_path = absolute_path(argv[command_index]);
  DWORD command_error = ERROR_SUCCESS;
  if (command_path == NULL) command_error = GetLastError();
  else {
    DWORD attributes = GetFileAttributesW(command_path);
    if (attributes == INVALID_FILE_ATTRIBUTES) command_error = GetLastError();
    else if (attributes & FILE_ATTRIBUTE_DIRECTORY) command_error = ERROR_FILE_NOT_FOUND;
  }
  if (command_error != ERROR_SUCCESS) {
    print_win32_error(L"resolve command", command_error);
    goto cleanup;
  }
  if (allowlisted_root && !beneath(allowlisted_root, command_path)) {
    print_win32_error(L"validate allowlisted command", ERROR_ACCESS_DENIED);
    goto cleanup;
  }
  argv[command_index] = command_path;
  command_line = build_command_line(argc - command_index, argv + command_index);
  if (command_line == NULL) {
    print_win32_error(L"build command line", ERROR_OUTOFMEMORY);
    goto cleanup;
  }
  if (!append_path(&programs, command_path)) {
    print_win32_error(L"record network-denied command", GetLastError());
    goto cleanup;
  }
  if (allowlisted_root) {
    for (size_t program = 0; program < programs.count; ++program) {
      int executable_grant = 0;
      for (size_t grant = 0; grant < requested_count; ++grant) {
        if (requested[grant].kind == GRANT_READ_EXECUTE &&
            beneath(requested[grant].path, programs.items[program])) executable_grant = 1;
      }
      if (!executable_grant) {
        print_win32_error(L"validate allowlisted executable grant", ERROR_ACCESS_DENIED);
        goto cleanup;
      }
    }
  }
  DWORD boundary_result = establish_network_boundary(&programs, &filter_engine);
  if (boundary_result != ERROR_SUCCESS) {
    print_win32_error(L"establish dynamic WFP boundary", boundary_result);
    goto cleanup;
  }

  if (!network_only) {
    acl_mutex = CreateMutexW(NULL, FALSE, L"Local\\tsfg-windows-sandbox-acl-v1");
    if (acl_mutex == NULL) {
      print_win32_error(L"create ACL serialization mutex", GetLastError());
      goto cleanup;
    }
    DWORD mutex_wait = WaitForSingleObject(acl_mutex, INFINITE);
    if (mutex_wait != WAIT_OBJECT_0 && mutex_wait != WAIT_ABANDONED) {
      print_win32_error(L"acquire ACL serialization mutex",
                        mutex_wait == WAIT_FAILED ? GetLastError()
                                                  : ERROR_GEN_FAILURE);
      goto cleanup;
    }
    acl_mutex_owned = 1;
    if (!OpenProcessToken(GetCurrentProcess(),
                          TOKEN_ADJUST_DEFAULT | TOKEN_ASSIGN_PRIMARY |
                              TOKEN_DUPLICATE | TOKEN_QUERY,
                          &process_token)) {
      print_win32_error(L"open process token", GetLastError());
      goto cleanup;
    }
    DWORD token_user_size = 0;
    GetTokenInformation(process_token, TokenUser, NULL, 0, &token_user_size);
    if (token_user_size == 0 || GetLastError() != ERROR_INSUFFICIENT_BUFFER) {
      print_win32_error(L"size process token user", GetLastError());
      goto cleanup;
    }
    token_user = (TOKEN_USER *)calloc(1, token_user_size);
    if (token_user == NULL ||
        !GetTokenInformation(process_token, TokenUser, token_user,
                             token_user_size, &token_user_size)) {
      print_win32_error(L"read process token user",
                        token_user == NULL ? ERROR_OUTOFMEMORY : GetLastError());
      goto cleanup;
    }
    if (!CreateWellKnownSid(WinLowLabelSid, NULL, low_integrity_sid,
                            &low_integrity_sid_size)) {
      print_win32_error(L"create low-integrity SID", GetLastError());
      goto cleanup;
    }
    if (allowlisted_root) {
      GUID random;
      SID_IDENTIFIER_AUTHORITY authority = SECURITY_NT_AUTHORITY;
      if (FAILED(CoCreateGuid(&random)) || !AllocateAndInitializeSid(&authority, 5,
          SECURITY_NT_NON_UNIQUE, random.Data1,
          ((DWORD)random.Data2 << 16) | random.Data3,
          ((DWORD)random.Data4[0] << 24) | ((DWORD)random.Data4[1] << 16) |
              ((DWORD)random.Data4[2] << 8) | random.Data4[3],
          0x54534647, 0, 0, 0, &unique_sid)) goto cleanup;
      token_groups = token_information(process_token, TokenGroups);
      if (!token_groups) goto cleanup;
      disabled_groups = calloc(token_groups->GroupCount, sizeof(*disabled_groups));
      if (!disabled_groups) goto cleanup;
      for (DWORD i = 0; i < token_groups->GroupCount; ++i) {
        SID_AND_ATTRIBUTES group = token_groups->Groups[i];
        if (!(group.Attributes & SE_GROUP_INTEGRITY) &&
            !(group.Attributes & SE_GROUP_LOGON_ID))
          disabled_groups[disabled_count++] = group;
      }
    }
    if (requested_count > SIZE_MAX / sizeof(*applied)) goto cleanup;
    applied = requested_count == 0 ? NULL
                                   : (struct applied_grant *)calloc(
                                         requested_count, sizeof(*applied));
    if (requested_count != 0 && applied == NULL) {
      print_win32_error(L"allocate ACL rollback state", ERROR_OUTOFMEMORY);
      goto cleanup;
    }
    for (size_t index = 0; index < requested_count; ++index) {
      if (!allowlisted_root && (requested[index].kind == GRANT_READ_ONLY ||
          requested[index].kind == GRANT_READ_EXECUTE)) {
        if (GetFileAttributesW(requested[index].path) == INVALID_FILE_ATTRIBUTES) {
          print_win32_error(L"validate restricted read path", GetLastError());
          goto cleanup;
        }
        continue;
      }
      DWORD result = apply_grant(&requested[index], unique_sid ? unique_sid : token_user->User.Sid,
                                 &applied[applied_count]);
      if (result != ERROR_SUCCESS) {
        print_win32_error(L"grant restricted path access", result);
        goto cleanup;
      }
      ++applied_count;
    }
    SID_AND_ATTRIBUTES restriction = {unique_sid, 0};
    if (!CreateRestrictedToken(process_token, DISABLE_MAX_PRIVILEGE,
                               disabled_count, disabled_groups, 0, NULL,
                               unique_sid ? 1 : 0, unique_sid ? &restriction : NULL,
                               &restricted_token)) {
      print_win32_error(L"create restricted token", GetLastError());
      goto cleanup;
    }
    TOKEN_MANDATORY_LABEL mandatory_label;
    ZeroMemory(&mandatory_label, sizeof(mandatory_label));
    mandatory_label.Label.Sid = low_integrity_sid;
    mandatory_label.Label.Attributes =
        SE_GROUP_INTEGRITY | SE_GROUP_INTEGRITY_ENABLED;
    if (!SetTokenInformation(
            restricted_token, TokenIntegrityLevel, &mandatory_label,
            sizeof(mandatory_label) + GetLengthSid(low_integrity_sid))) {
      print_win32_error(L"set restricted token integrity", GetLastError());
      goto cleanup;
    }
  }

  startup.cb = sizeof(startup);
  startup.dwFlags = STARTF_USESTDHANDLES;
  startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
  startup.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
  startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);
  if (allowlisted_root) {
    HANDLE standard[] = {startup.hStdInput, startup.hStdOutput, startup.hStdError};
    for (size_t i = 0; i < 3; ++i) {
      if (!DuplicateHandle(GetCurrentProcess(), standard[i], GetCurrentProcess(),
          &inherited[i], 0, TRUE, DUPLICATE_SAME_ACCESS)) {
        print_win32_error(L"duplicate restricted standard handle", GetLastError());
        goto cleanup;
      }
    }
    extended_startup.StartupInfo = startup;
    extended_startup.StartupInfo.cb = sizeof(extended_startup);
    extended_startup.StartupInfo.hStdInput = inherited[0];
    extended_startup.StartupInfo.hStdOutput = inherited[1];
    extended_startup.StartupInfo.hStdError = inherited[2];
    InitializeProcThreadAttributeList(NULL, 1, 0, &attribute_size);
    extended_startup.lpAttributeList = calloc(1, attribute_size);
    if (!extended_startup.lpAttributeList ||
        !InitializeProcThreadAttributeList(extended_startup.lpAttributeList, 1, 0,
                                           &attribute_size) ||
        !UpdateProcThreadAttribute(extended_startup.lpAttributeList, 0,
            PROC_THREAD_ATTRIBUTE_HANDLE_LIST, inherited, sizeof(inherited), NULL, NULL)) {
      print_win32_error(L"restrict inherited handles", GetLastError());
      goto cleanup;
    }
  }
  job = CreateJobObjectW(NULL, NULL);
  if (job == NULL) {
    print_win32_error(L"create process job", GetLastError());
    goto cleanup;
  }
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits;
  ZeroMemory(&limits, sizeof(limits));
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation,
                               &limits, sizeof(limits))) {
    print_win32_error(L"configure process job", GetLastError());
    goto cleanup;
  }
  DWORD creation_flags = CREATE_UNICODE_ENVIRONMENT | CREATE_SUSPENDED;
  if (allowlisted_root) creation_flags |= EXTENDED_STARTUPINFO_PRESENT;
  BOOL created = network_only
      ? CreateProcessW(command_path, command_line, NULL, NULL, TRUE,
                       creation_flags, NULL, NULL, &startup, &process)
      : CreateProcessAsUserW(restricted_token, command_path, command_line,
                             NULL, NULL, TRUE, creation_flags, NULL, allowlisted_root,
                             allowlisted_root ? &extended_startup.StartupInfo : &startup,
                             &process);
  if (!created) {
    print_win32_error(L"create restricted process", GetLastError());
    goto cleanup;
  }
  child_started = 1;
  if (!AssignProcessToJobObject(job, process.hProcess)) {
    print_win32_error(L"assign restricted process to job", GetLastError());
    goto cleanup;
  }
  if (ResumeThread(process.hThread) == (DWORD)-1) {
    print_win32_error(L"resume restricted process", GetLastError());
    goto cleanup;
  }
  CloseHandle(process.hThread);
  process.hThread = NULL;
  DWORD wait_result = WaitForSingleObject(process.hProcess, INFINITE);
  if (wait_result != WAIT_OBJECT_0) {
    print_win32_error(L"wait for restricted process",
                      wait_result == WAIT_FAILED ? GetLastError() : ERROR_GEN_FAILURE);
    goto cleanup;
  }
  DWORD child_status = 0;
  if (!GetExitCodeProcess(process.hProcess, &child_status) ||
      child_status == STILL_ACTIVE) {
    print_win32_error(L"read restricted process status", GetLastError());
    goto cleanup;
  }
  child_complete = 1;
  if (
      (child_status == SANDBOX_SETUP_FAILURE_STATUS ||
       child_status == SANDBOX_NETWORK_BOUNDARY_STATUS ||
       child_status == SANDBOX_UNDECLARED_INPUT_STATUS) &&
      child_status != boundary_status
  ) {
    fwprintf(stderr,
             L"tsfg windows sandbox: child used reserved status %lu\n",
             (unsigned long)child_status);
    status = 126;
  } else {
    status = (int)child_status;
  }

cleanup:
  /* Do not release WFP or ACLs until every descendant has left the job. */
  if (allowlisted_root && job != NULL && child_started) {
    if (!TerminateJobObject(job, SANDBOX_SETUP_FAILURE_STATUS)) {
      print_win32_error(L"terminate restricted process job", GetLastError());
      cleanup_failed = 1;
    }
    for (;;) {
      JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting;
      if (!QueryInformationJobObject(job, JobObjectBasicAccountingInformation,
          &accounting, sizeof(accounting), NULL)) {
        /* Fail closed: retain the dynamic WFP session rather than returning. */
        print_win32_error(L"query restricted process job", GetLastError());
        Sleep(1000);
        continue;
      }
      if (accounting.ActiveProcesses == 0) break;
      Sleep(10);
    }
  }
  if (child_started && !child_complete && process.hProcess != NULL) {
    if (!TerminateProcess(process.hProcess, SANDBOX_SETUP_FAILURE_STATUS) ||
        WaitForSingleObject(process.hProcess, INFINITE) != WAIT_OBJECT_0) {
      print_win32_error(L"terminate incomplete restricted process", GetLastError());
      cleanup_failed = 1;
    }
  }
  if (process.hThread != NULL) CloseHandle(process.hThread);
  if (process.hProcess != NULL) CloseHandle(process.hProcess);
  if (job != NULL) CloseHandle(job);
  if (restricted_token != NULL) CloseHandle(restricted_token);
  if (process_token != NULL) CloseHandle(process_token);
  if (unique_sid != NULL) FreeSid(unique_sid);
  free(token_groups);
  free(disabled_groups);
  if (extended_startup.lpAttributeList) {
    DeleteProcThreadAttributeList(extended_startup.lpAttributeList);
    free(extended_startup.lpAttributeList);
  }
  for (size_t i = 0; i < 3; ++i) if (inherited[i]) CloseHandle(inherited[i]);
  free(token_user);
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
    for (size_t index = 0; index < requested_count; ++index) {
      free_applied_grant(&applied[index]);
    }
    free(applied);
  }
  if (filter_engine != NULL) FwpmEngineClose0(filter_engine);
  if (acl_mutex != NULL) {
    if (acl_mutex_owned) ReleaseMutex(acl_mutex);
    CloseHandle(acl_mutex);
  }
  free(command_line);
  free(command_path);
  free_requested_grants(requested, requested_count);
  free_paths(&programs);
  for (size_t i = 0; i < pinned_count; ++i) CloseHandle(pinned_paths[i]);
  free(pinned_paths);
  free(allowlisted_root);
  if (cleanup_failed) return SANDBOX_SETUP_FAILURE_STATUS;
  return status;
}
