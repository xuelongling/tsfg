// SPDX-License-Identifier: MIT

#define WIN32_LEAN_AND_MEAN
#define _WIN32_WINNT 0x0A00
#include <windows.h>
#include <winioctl.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
#include <wctype.h>

struct mount_point_buffer {
  DWORD tag;
  WORD data_length;
  WORD reserved;
  WORD substitute_offset;
  WORD substitute_length;
  WORD print_offset;
  WORD print_length;
  WCHAR names[1];
};

static int fail(const wchar_t *operation, DWORD error) {
  fwprintf(stderr, L"windows-publish: %ls (Win32 %lu)\n", operation, error);
  return 1;
}

/* This helper deliberately accepts local drive paths only. GetFullPathNameW
 * resolves lexical dot components; opening the targets below rejects reparse
 * directories instead of following a substituted target. */
static wchar_t *normalize_path(const wchar_t *input) {
  const wchar_t *local = input;
  if (wcsncmp(local, L"\\\\?\\", 4) == 0 ||
      wcsncmp(local, L"\\??\\", 4) == 0) local += 4;
  size_t length = wcslen(local);
  if (length < 3 || !iswalpha(local[0]) || local[1] != L':' ||
      (local[2] != L'\\' && local[2] != L'/') ||
      wcschr(local + 2, L':') != NULL) {
    SetLastError(ERROR_INVALID_NAME);
    return NULL;
  }
  DWORD capacity = GetFullPathNameW(local, 0, NULL, NULL);
  if (capacity == 0) return NULL;
  wchar_t *result = calloc(capacity, sizeof(wchar_t));
  if (!result) {
    SetLastError(ERROR_NOT_ENOUGH_MEMORY);
    return NULL;
  }
  DWORD written = GetFullPathNameW(local, capacity, result, NULL);
  if (written == 0 || written >= capacity) {
    DWORD error = written == 0 ? GetLastError() : ERROR_INSUFFICIENT_BUFFER;
    free(result);
    SetLastError(error);
    return NULL;
  }
  for (DWORD index = 0; index < written; index++) {
    if (result[index] == L'/') result[index] = L'\\';
  }
  while (written > 3 && result[written - 1] == L'\\') result[--written] = 0;
  return result;
}

static HANDLE open_path(const wchar_t *path, DWORD access, DWORD sharing) {
  size_t length = wcslen(path);
  wchar_t *extended = calloc(length + 5, sizeof(wchar_t));
  if (!extended) {
    SetLastError(ERROR_NOT_ENOUGH_MEMORY);
    return INVALID_HANDLE_VALUE;
  }
  wcscpy(extended, L"\\\\?\\");
  wcscpy(extended + 4, path);
  HANDLE handle = CreateFileW(extended, access, sharing, NULL, OPEN_EXISTING,
      FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS, NULL);
  DWORD error = GetLastError();
  free(extended);
  SetLastError(error);
  return handle;
}

static HANDLE open_directory(const wchar_t *path) {
  HANDLE handle = open_path(path, FILE_READ_ATTRIBUTES,
      FILE_SHARE_READ | FILE_SHARE_WRITE);
  if (handle == INVALID_HANDLE_VALUE) return handle;
  BY_HANDLE_FILE_INFORMATION information;
  if (!GetFileInformationByHandle(handle, &information)) {
    DWORD error = GetLastError();
    CloseHandle(handle);
    SetLastError(error);
    return INVALID_HANDLE_VALUE;
  }
  if (!(information.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) ||
      (information.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)) {
    CloseHandle(handle);
    SetLastError(ERROR_REPARSE_ATTRIBUTE_CONFLICT);
    return INVALID_HANDLE_VALUE;
  }
  return handle;
}

static int direct_child(const wchar_t *root, const wchar_t *child) {
  size_t length = wcslen(root);
  return wcslen(child) > length + 1 &&
      _wcsnicmp(root, child, length) == 0 && child[length] == L'\\' &&
      wcschr(child + length + 1, L'\\') == NULL;
}

int wmain(int argc, wchar_t **argv) {
  if (argc != 4) return fail(L"expected destination, old target, new target", ERROR_BAD_ARGUMENTS);
  int result = 1;
  DWORD error = ERROR_SUCCESS;
  const wchar_t *operation = L"normalize paths";
  wchar_t *destination = NULL, *previous = NULL, *next = NULL, *versions = NULL;
  wchar_t *actual = NULL, *substitute = NULL;
  struct mount_point_buffer *buffer = NULL;
  HANDLE root_handle = INVALID_HANDLE_VALUE, old_handle = INVALID_HANDLE_VALUE;
  HANDLE new_handle = INVALID_HANDLE_VALUE, link_handle = INVALID_HANDLE_VALUE;
  destination = normalize_path(argv[1]);
  if (!destination) goto failed;
  previous = normalize_path(argv[2]);
  if (!previous) goto failed;
  next = normalize_path(argv[3]);
  if (!next) goto failed;
  const wchar_t *basename = wcsrchr(destination, L'\\');
  if (!basename || !basename[1]) {
    SetLastError(ERROR_INVALID_NAME);
    goto failed;
  }
  size_t parent_length = (size_t)(basename - destination) + 1;
  versions = calloc(wcslen(destination) + 11, sizeof(wchar_t));
  if (!versions) { SetLastError(ERROR_NOT_ENOUGH_MEMORY); goto failed; }
  wmemcpy(versions, destination, parent_length);
  wcscat(versions, L".");
  wcscat(versions, basename + 1);
  wcscat(versions, L".versions");
  operation = L"validate managed version targets";
  if (!direct_child(versions, previous) || !direct_child(versions, next)) {
    SetLastError(ERROR_INVALID_NAME);
    goto failed;
  }
  root_handle = open_directory(versions);
  if (root_handle == INVALID_HANDLE_VALUE) goto failed;
  old_handle = open_directory(previous);
  if (old_handle == INVALID_HANDLE_VALUE) goto failed;
  new_handle = open_directory(next);
  if (new_handle == INVALID_HANDLE_VALUE) goto failed;

  /* No WRITE/DELETE sharing: serialize writers and prevent replacement of the
   * junction object between its expected-target check and its update. */
  operation = L"open existing junction";
  link_handle = open_path(destination, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ);
  if (link_handle == INVALID_HANDLE_VALUE) goto failed;
  buffer = calloc(1, MAXIMUM_REPARSE_DATA_BUFFER_SIZE);
  if (!buffer) { SetLastError(ERROR_NOT_ENOUGH_MEMORY); goto failed; }
  DWORD received = 0;
  operation = L"read existing junction";
  if (!DeviceIoControl(link_handle, FSCTL_GET_REPARSE_POINT, NULL, 0,
      buffer, MAXIMUM_REPARSE_DATA_BUFFER_SIZE, &received, NULL)) goto failed;
  operation = L"validate existing junction";
  if (received < 16 || buffer->tag != IO_REPARSE_TAG_MOUNT_POINT ||
      buffer->data_length < 8 || (DWORD)buffer->data_length + 8 > received ||
      buffer->substitute_offset % sizeof(wchar_t) != 0 ||
      buffer->substitute_length % sizeof(wchar_t) != 0 ||
      (DWORD)buffer->substitute_offset + buffer->substitute_length >
          (DWORD)buffer->data_length - 8) {
    SetLastError(ERROR_INVALID_REPARSE_DATA);
    goto failed;
  }
  size_t characters = buffer->substitute_length / sizeof(wchar_t);
  substitute = calloc(characters + 1, sizeof(wchar_t));
  if (!substitute) { SetLastError(ERROR_NOT_ENOUGH_MEMORY); goto failed; }
  memcpy(substitute, (BYTE *)buffer->names + buffer->substitute_offset,
      buffer->substitute_length);
  if (wcslen(substitute) != characters) {
    SetLastError(ERROR_INVALID_REPARSE_DATA);
    goto failed;
  }
  actual = normalize_path(substitute);
  if (!actual) goto failed;
  if (_wcsicmp(actual, previous) != 0) {
    SetLastError(ERROR_REPARSE_ATTRIBUTE_CONFLICT);
    goto failed;
  }

  size_t next_length = wcslen(next);
  size_t substitute_bytes = (next_length + 4) * sizeof(wchar_t);
  size_t print_bytes = next_length * sizeof(wchar_t);
  size_t total = 16 + substitute_bytes + sizeof(wchar_t) + print_bytes + sizeof(wchar_t);
  operation = L"prepare replacement junction";
  if (total > MAXIMUM_REPARSE_DATA_BUFFER_SIZE) {
    SetLastError(ERROR_FILENAME_EXCED_RANGE);
    goto failed;
  }
  ZeroMemory(buffer, MAXIMUM_REPARSE_DATA_BUFFER_SIZE);
  buffer->tag = IO_REPARSE_TAG_MOUNT_POINT;
  buffer->data_length = (WORD)(total - 8);
  buffer->substitute_length = (WORD)substitute_bytes;
  buffer->print_offset = (WORD)(substitute_bytes + sizeof(wchar_t));
  buffer->print_length = (WORD)print_bytes;
  wcscpy(buffer->names, L"\\??\\");
  wcscpy(buffer->names + 4, next);
  wcscpy((wchar_t *)((BYTE *)buffer->names + buffer->print_offset), next);
  operation = L"replace junction target";
  if (!DeviceIoControl(link_handle, FSCTL_SET_REPARSE_POINT, buffer,
      (DWORD)total, NULL, 0, &received, NULL)) goto failed;
  result = 0;
  goto cleanup;

failed:
  error = GetLastError();
  result = fail(operation, error);
cleanup:
  if (link_handle != INVALID_HANDLE_VALUE) CloseHandle(link_handle);
  if (new_handle != INVALID_HANDLE_VALUE) CloseHandle(new_handle);
  if (old_handle != INVALID_HANDLE_VALUE) CloseHandle(old_handle);
  if (root_handle != INVALID_HANDLE_VALUE) CloseHandle(root_handle);
  free(buffer);
  free(substitute);
  free(actual);
  free(versions);
  free(next);
  free(previous);
  free(destination);
  return result;
}
