@echo off
rem SPDX-License-Identifier: MIT
setlocal EnableExtensions
call :find_report %*
set "TSFG_COMMAND=%~1"
set "TSFG_REPOSITORY=%~dp0.."
set "TSFG_LOCK_ID=9df4062f8570fb8b396287c973ec2348814db660ef1cfd428d1895eaaefe623a"
set "TSFG_NODE_ID=5c976096e04e5c2c1f091938926234cc9fbebfe9787ddd149351b3b0ecc707b5"
if defined TSFG_CACHE_DIR (
  set "TSFG_CACHE=%TSFG_CACHE_DIR%"
) else (
  set "TSFG_CACHE=%TSFG_REPOSITORY%\.tsfg-cache"
)

if "%~1"=="prefetch" (
  node "%~dp0tsfg-build.mjs" %* --lock "%~dp0toolchains.lock.json" --cache "%TSFG_CACHE%" --platform windows-x86_64
  exit /b %errorlevel%
)
if not "%~1"=="verify-workspace" (
  set "TSFG_USAGE_COMMAND=unsupported"
  set "TSFG_USAGE_CODE=unsupported-operation"
  set "TSFG_USAGE_MESSAGE=unsupported operation"
  goto usage
)
call :validate_verify %*
if errorlevel 1 (
  set "TSFG_USAGE_COMMAND=verify-workspace"
  set "TSFG_USAGE_CODE=invalid-configuration"
  set "TSFG_USAGE_MESSAGE=invalid verify-workspace arguments"
  goto usage
)

set "TSFG_ACTIVE=%TSFG_CACHE%\active\windows-x86_64"
if not exist "%TSFG_ACTIVE%" (
  goto runtime_failure
)
set /p TSFG_CLOSURE=<"%TSFG_ACTIVE%"
if /i not "%TSFG_CLOSURE%"=="closures/sha256/%TSFG_LOCK_ID%/windows-x86_64" (
  goto runtime_failure
)
set "TSFG_NODE=%TSFG_CACHE%\%TSFG_CLOSURE:/=\%\node\node.exe"
if not exist "%TSFG_NODE%" (
  goto runtime_failure
)
set "TSFG_HASHER=%SystemRoot%\System32\certutil.exe"
if not exist "%TSFG_HASHER%" goto runtime_failure
set "TSFG_NODE_ACTUAL="
for /f "skip=1 delims=" %%H in ('%SystemRoot%\System32\certutil.exe -hashfile "%TSFG_NODE%" SHA256 2^>nul') do if not defined TSFG_NODE_ACTUAL set "TSFG_NODE_ACTUAL=%%H"
set "TSFG_NODE_ACTUAL=%TSFG_NODE_ACTUAL: =%"
if /i not "%TSFG_NODE_ACTUAL%"=="%TSFG_NODE_ID%" goto runtime_failure
for %%G in (git.exe) do set "TSFG_GIT=%%~$PATH:G"
set "TSFG_RUNTIME_LOCK=%~dp0toolchains.lock.json"
set "TSFG_RUNTIME_CACHE=%TSFG_CACHE%"
set "TSFG_RUNTIME_PLATFORM=windows-x86_64"
"%TSFG_NODE%" "%~dp0tsfg-build.mjs" %*
exit /b %errorlevel%

:find_report
if "%~1"=="" exit /b 0
if "%~1"=="--report" (
  set "TSFG_REPORT=%~2"
  exit /b 0
)
shift
goto find_report

:validate_verify
set "TSFG_SEEN_WORKSPACE="
set "TSFG_SEEN_MANIFEST_URL="
set "TSFG_SEEN_MANIFEST_REVISION="
set "TSFG_SEEN_MANIFEST="
set "TSFG_SEEN_REPORT="
set "TSFG_MANIFEST_REVISION="
set "TSFG_MANIFEST="
shift
:validate_verify_loop
if "%~1"=="" goto validate_verify_done
if "%~2"=="" exit /b 1
if "%~1"=="--workspace" goto validate_verify_workspace
if "%~1"=="--manifest-url" goto validate_verify_manifest_url
if "%~1"=="--manifest-revision" goto validate_verify_manifest_revision
if "%~1"=="--manifest" goto validate_verify_manifest
if "%~1"=="--report" goto validate_verify_report
exit /b 1
:validate_verify_workspace
if defined TSFG_SEEN_WORKSPACE exit /b 1
set "TSFG_SEEN_WORKSPACE=1"
goto validate_verify_next
:validate_verify_manifest_url
if defined TSFG_SEEN_MANIFEST_URL exit /b 1
set "TSFG_SEEN_MANIFEST_URL=1"
goto validate_verify_next
:validate_verify_manifest_revision
if defined TSFG_SEEN_MANIFEST_REVISION exit /b 1
set "TSFG_SEEN_MANIFEST_REVISION=1"
set "TSFG_MANIFEST_REVISION=%~2"
goto validate_verify_next
:validate_verify_manifest
if defined TSFG_SEEN_MANIFEST exit /b 1
set "TSFG_SEEN_MANIFEST=1"
set "TSFG_MANIFEST=%~2"
goto validate_verify_next
:validate_verify_report
if defined TSFG_SEEN_REPORT exit /b 1
set "TSFG_SEEN_REPORT=1"
:validate_verify_next
shift
shift
goto validate_verify_loop
:validate_verify_done
if not defined TSFG_SEEN_WORKSPACE exit /b 1
if not defined TSFG_SEEN_MANIFEST_URL exit /b 1
if not defined TSFG_SEEN_MANIFEST_REVISION exit /b 1
if not defined TSFG_SEEN_MANIFEST exit /b 1
call :validate_oid "%TSFG_MANIFEST_REVISION%"
if errorlevel 1 exit /b 1
call :validate_manifest_path "%TSFG_MANIFEST%"
if errorlevel 1 exit /b 1
exit /b 0

:validate_oid
set "TSFG_VALUE=%~1"
if "%TSFG_VALUE:~39,1%"=="" exit /b 1
if not "%TSFG_VALUE:~40,1%"=="" exit /b 1
:validate_oid_loop
if "%TSFG_VALUE%"=="" exit /b 0
set "TSFG_CHARACTER=%TSFG_VALUE:~0,1%"
set "TSFG_VALUE=%TSFG_VALUE:~1%"
if "%TSFG_CHARACTER%"=="0" goto validate_oid_loop
if "%TSFG_CHARACTER%"=="1" goto validate_oid_loop
if "%TSFG_CHARACTER%"=="2" goto validate_oid_loop
if "%TSFG_CHARACTER%"=="3" goto validate_oid_loop
if "%TSFG_CHARACTER%"=="4" goto validate_oid_loop
if "%TSFG_CHARACTER%"=="5" goto validate_oid_loop
if "%TSFG_CHARACTER%"=="6" goto validate_oid_loop
if "%TSFG_CHARACTER%"=="7" goto validate_oid_loop
if "%TSFG_CHARACTER%"=="8" goto validate_oid_loop
if "%TSFG_CHARACTER%"=="9" goto validate_oid_loop
if "%TSFG_CHARACTER%"=="a" goto validate_oid_loop
if "%TSFG_CHARACTER%"=="b" goto validate_oid_loop
if "%TSFG_CHARACTER%"=="c" goto validate_oid_loop
if "%TSFG_CHARACTER%"=="d" goto validate_oid_loop
if "%TSFG_CHARACTER%"=="e" goto validate_oid_loop
if "%TSFG_CHARACTER%"=="f" goto validate_oid_loop
exit /b 1

:validate_manifest_path
set "TSFG_VALUE=%~1"
if "%TSFG_VALUE:~0,1%"=="/" exit /b 1
if "%TSFG_VALUE:~0,1%"=="\" exit /b 1
if "%TSFG_VALUE:~1,2%"==":/" exit /b 1
if "%TSFG_VALUE:~1,2%"==":\" exit /b 1
set "TSFG_SEGMENT="
:validate_manifest_path_loop
if "%TSFG_VALUE%"=="" goto validate_manifest_path_done
set "TSFG_CHARACTER=%TSFG_VALUE:~0,1%"
set "TSFG_VALUE=%TSFG_VALUE:~1%"
if "%TSFG_CHARACTER%"=="/" goto validate_manifest_path_separator
if "%TSFG_CHARACTER%"=="\" goto validate_manifest_path_separator
set "TSFG_SEGMENT=%TSFG_SEGMENT%%TSFG_CHARACTER%"
goto validate_manifest_path_loop
:validate_manifest_path_separator
if "%TSFG_SEGMENT%"=="" exit /b 1
if "%TSFG_SEGMENT%"==".." exit /b 1
set "TSFG_SEGMENT="
goto validate_manifest_path_loop
:validate_manifest_path_done
if "%TSFG_SEGMENT%"=="" exit /b 1
if "%TSFG_SEGMENT%"==".." exit /b 1
exit /b 0

:runtime_failure
set "TSFG_MESSAGE=locked Node.js closure is missing or invalid; run tsfg-build prefetch"
if not defined TSFG_REPORT goto runtime_failure_stderr
for %%D in ("%TSFG_REPORT%") do if not exist "%%~dpD" mkdir "%%~dpD" >nul 2>nul
set "TSFG_REPORT_TEMP=%TSFG_REPORT%.%RANDOM%.tmp"
>"%TSFG_REPORT_TEMP%" echo {"command":"verify-workspace","error":{"category":"lock/integrity","code":"11","issues":[{"code":"runtime-closure","message":"%TSFG_MESSAGE%"}]},"network":"offline","schemaVersion":"1","status":"failure","telemetry":false}
if errorlevel 1 goto runtime_failure_report_error
move /y "%TSFG_REPORT_TEMP%" "%TSFG_REPORT%" >nul 2>nul
if errorlevel 1 goto runtime_failure_report_error
:runtime_failure_stderr
>&2 echo %TSFG_MESSAGE%
exit /b 11
:runtime_failure_report_error
del /q "%TSFG_REPORT_TEMP%" >nul 2>nul
>&2 echo cannot write Build Report for runtime closure failure
exit /b 30

:usage
set "TSFG_MESSAGE=%TSFG_USAGE_MESSAGE%"
if not defined TSFG_REPORT goto usage_failure_stderr
for %%D in ("%TSFG_REPORT%") do if not exist "%%~dpD" mkdir "%%~dpD" >nul 2>nul
set "TSFG_REPORT_TEMP=%TSFG_REPORT%.%RANDOM%.tmp"
>"%TSFG_REPORT_TEMP%" echo {"command":"%TSFG_USAGE_COMMAND%","error":{"category":"usage/configuration","code":"2","issues":[{"code":"%TSFG_USAGE_CODE%","message":"%TSFG_USAGE_MESSAGE%"}]},"network":"disabled","schemaVersion":"1","status":"failure","telemetry":false}
if errorlevel 1 goto usage_failure_report_error
move /y "%TSFG_REPORT_TEMP%" "%TSFG_REPORT%" >nul 2>nul
if errorlevel 1 goto usage_failure_report_error
:usage_failure_stderr
>&2 echo %TSFG_MESSAGE%
exit /b 2
:usage_failure_report_error
del /q "%TSFG_REPORT_TEMP%" >nul 2>nul
>&2 echo cannot write Build Report for unsupported operation
exit /b 30
