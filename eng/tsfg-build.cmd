@echo off
rem SPDX-License-Identifier: MIT
setlocal
set "TSFG_REPOSITORY=%~dp0.."
if defined TSFG_CACHE_DIR (
  set "TSFG_CACHE=%TSFG_CACHE_DIR%"
) else (
  set "TSFG_CACHE=%TSFG_REPOSITORY%\.tsfg-cache"
)

if /i "%~1"=="prefetch" (
  node "%~dp0tsfg-build.mjs" %* --lock "%~dp0toolchains.lock.json" --cache "%TSFG_CACHE%" --platform windows-x86_64
  exit /b %errorlevel%
)

set "TSFG_ACTIVE=%TSFG_CACHE%\active\windows-x86_64"
if not exist "%TSFG_ACTIVE%" (
  >&2 echo locked Node.js closure is missing; run tsfg-build prefetch first
  exit /b 11
)
set /p TSFG_CLOSURE=<"%TSFG_ACTIVE%"
set "TSFG_NODE=%TSFG_CACHE%\%TSFG_CLOSURE:/=\%\node\node.exe"
if not exist "%TSFG_NODE%" (
  >&2 echo locked Node.js executable is missing or corrupt; rerun tsfg-build prefetch
  exit /b 11
)
for %%G in (git.exe) do set "TSFG_GIT=%%~$PATH:G"
"%TSFG_NODE%" "%~dp0tsfg-build.mjs" %*
exit /b %errorlevel%
