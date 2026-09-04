@echo off
rem SPDX-License-Identifier: MIT
setlocal EnableExtensions
call :find_report %*
set "TSFG_COMMAND=%~1"
set "TSFG_REPOSITORY=%~dp0.."
set "TSFG_LOCK_ID=a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85"
set "TSFG_NODE_ID=5c976096e04e5c2c1f091938926234cc9fbebfe9787ddd149351b3b0ecc707b5"
set "TSFG_CONTROL_ID=d05184737f779408dba588af02dc9448cab5db00dd289fd25c248692f6ee6b13"
if defined TSFG_CACHE_DIR (
  set "TSFG_CACHE=%TSFG_CACHE_DIR%"
) else (
  set "TSFG_CACHE=%TSFG_REPOSITORY%\.tsfg-cache"
)

if "%~1"=="prefetch" goto prefetch
if "%~1"=="verify-workspace" (
  call :validate_verify %*
  if errorlevel 1 (
    set "TSFG_USAGE_COMMAND=verify-workspace"
    set "TSFG_USAGE_CODE=invalid-configuration"
    set "TSFG_USAGE_MESSAGE=invalid verify-workspace arguments"
    goto usage
  )
  goto runtime
)
if "%~1"=="build" goto runtime
if "%~1"=="test" goto runtime
if "%~1"=="package" goto runtime
(
  set "TSFG_USAGE_COMMAND=unsupported"
  set "TSFG_USAGE_CODE=unsupported-operation"
  set "TSFG_USAGE_MESSAGE=unsupported operation"
  goto usage
)

:runtime
set "TSFG_ACTIVE=%TSFG_CACHE%\active\windows-x86_64-msvc"
if not exist "%TSFG_ACTIVE%" (
  goto runtime_failure
)
set /p TSFG_CLOSURE=<"%TSFG_ACTIVE%"
if /i not "%TSFG_CLOSURE%"=="closures/sha256/%TSFG_LOCK_ID%/windows-x86_64-msvc" (
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
call :trusted_git
if errorlevel 1 goto runtime_failure
set "TSFG_CONTROL=%TSFG_CACHE%\controls\%TSFG_CONTROL_ID%\windows-sandbox-run.exe"
if not exist "%TSFG_CONTROL%" (
  set "TSFG_RUNTIME_MESSAGE=Windows sandbox control is missing; run tsfg-build prefetch"
  goto runtime_failure
)
set "TSFG_CONTROL_ACTUAL="
for /f "skip=1 delims=" %%H in ('%SystemRoot%\System32\certutil.exe -hashfile "%TSFG_CONTROL%" SHA256 2^>nul') do if not defined TSFG_CONTROL_ACTUAL set "TSFG_CONTROL_ACTUAL=%%H"
set "TSFG_CONTROL_ACTUAL=%TSFG_CONTROL_ACTUAL: =%"
if /i not "%TSFG_CONTROL_ACTUAL%"=="%TSFG_CONTROL_ID%" (
  set "TSFG_RUNTIME_MESSAGE=Windows sandbox control digest mismatch"
  goto runtime_failure
)
set "TSFG_RUNTIME_LOCK=%~dp0toolchains.lock.json"
set "TSFG_RUNTIME_CACHE=%TSFG_CACHE%"
set "TSFG_RUNTIME_PLATFORM=windows-x86_64-msvc"
set "NODE_OPTIONS="
set "NODE_PATH="
set "TSFG_WINDOWS_OFFLINE_ACTIVE="
set "TSFG_WINDOWS_BOUNDARY_ERROR="
set "NODE_REPL_EXTERNAL_MODULE="
set "NODE_EXTRA_CA_CERTS="
set "OPENSSL_CONF="
if "%TSFG_COMMAND%"=="build" goto offline_runtime
if "%TSFG_COMMAND%"=="test" goto offline_runtime
if "%TSFG_COMMAND%"=="package" goto offline_runtime
"%TSFG_NODE%" "%~dp0tsfg-build.mjs" %*
exit /b %errorlevel%

:offline_runtime
set "TSFG_WINDOWS_OFFLINE_ACTIVE=1"
"%TSFG_CONTROL%" --network-only --deny-network "%TSFG_NODE%" --deny-network "%TSFG_GIT%" --deny-network "%ComSpec%" -- "%TSFG_NODE%" "%~dp0tsfg-build.mjs" %*
set "TSFG_OFFLINE_STATUS=%errorlevel%"
if not "%TSFG_OFFLINE_STATUS%"=="125" exit /b %TSFG_OFFLINE_STATUS%
set "TSFG_WINDOWS_BOUNDARY_ERROR=Windows process-level WFP boundary is unavailable"
"%TSFG_NODE%" "%~dp0tsfg-build.mjs" %*
exit /b %errorlevel%

:trusted_git
if not defined TSFG_BOOTSTRAP_GIT (
  set "TSFG_RUNTIME_MESSAGE=offline commands require an absolute TSFG_BOOTSTRAP_GIT"
  exit /b 1
)
for %%I in ("%TSFG_BOOTSTRAP_GIT%") do set "TSFG_GIT_FULL=%%~fI"
if /i not "%TSFG_BOOTSTRAP_GIT%"=="%TSFG_GIT_FULL%" (
  set "TSFG_RUNTIME_MESSAGE=offline commands require an absolute TSFG_BOOTSTRAP_GIT"
  exit /b 1
)
if not exist "%TSFG_BOOTSTRAP_GIT%" (
  set "TSFG_RUNTIME_MESSAGE=bootstrap Git does not exist"
  exit /b 1
)
if not defined TSFG_BOOTSTRAP_GIT_SHA256 (
  set "TSFG_RUNTIME_MESSAGE=offline commands require a full TSFG_BOOTSTRAP_GIT_SHA256"
  exit /b 1
)
set "TSFG_GIT_ACTUAL="
for /f "skip=1 delims=" %%H in ('%SystemRoot%\System32\certutil.exe -hashfile "%TSFG_BOOTSTRAP_GIT%" SHA256 2^>nul') do if not defined TSFG_GIT_ACTUAL set "TSFG_GIT_ACTUAL=%%H"
set "TSFG_GIT_ACTUAL=%TSFG_GIT_ACTUAL: =%"
if /i not "%TSFG_GIT_ACTUAL%"=="%TSFG_BOOTSTRAP_GIT_SHA256%" (
  set "TSFG_RUNTIME_MESSAGE=bootstrap Git digest mismatch"
  exit /b 1
)
set "TSFG_GIT=%TSFG_BOOTSTRAP_GIT%"
exit /b 0

:prefetch
if not defined TSFG_BOOTSTRAP_NODE (
  set "TSFG_RUNTIME_MESSAGE=prefetch requires an absolute TSFG_BOOTSTRAP_NODE"
  goto runtime_failure
)
for %%I in ("%TSFG_BOOTSTRAP_NODE%") do set "TSFG_BOOTSTRAP_NODE_FULL=%%~fI"
if /i not "%TSFG_BOOTSTRAP_NODE%"=="%TSFG_BOOTSTRAP_NODE_FULL%" (
  set "TSFG_RUNTIME_MESSAGE=prefetch requires an absolute TSFG_BOOTSTRAP_NODE"
  goto runtime_failure
)
if not exist "%TSFG_BOOTSTRAP_NODE%" (
  set "TSFG_RUNTIME_MESSAGE=prefetch bootstrap Node does not exist"
  goto runtime_failure
)
if not defined TSFG_BOOTSTRAP_NODE_SHA256 (
  set "TSFG_RUNTIME_MESSAGE=prefetch requires a full TSFG_BOOTSTRAP_NODE_SHA256"
  goto runtime_failure
)
set "TSFG_BOOTSTRAP_ACTUAL="
for /f "skip=1 delims=" %%H in ('%SystemRoot%\System32\certutil.exe -hashfile "%TSFG_BOOTSTRAP_NODE%" SHA256 2^>nul') do if not defined TSFG_BOOTSTRAP_ACTUAL set "TSFG_BOOTSTRAP_ACTUAL=%%H"
set "TSFG_BOOTSTRAP_ACTUAL=%TSFG_BOOTSTRAP_ACTUAL: =%"
if /i not "%TSFG_BOOTSTRAP_ACTUAL%"=="%TSFG_BOOTSTRAP_NODE_SHA256%" (
  set "TSFG_RUNTIME_MESSAGE=prefetch bootstrap Node digest mismatch"
  goto runtime_failure
)
"%TSFG_BOOTSTRAP_NODE%" "%~dp0tsfg-build.mjs" %* --lock "%~dp0toolchains.lock.json" --cache "%TSFG_CACHE%" --platform windows-x86_64-msvc
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
set "TSFG_FAILURE_NETWORK=offline"
if "%TSFG_COMMAND%"=="prefetch" set "TSFG_FAILURE_NETWORK=online"
if defined TSFG_RUNTIME_MESSAGE (
  set "TSFG_MESSAGE=%TSFG_RUNTIME_MESSAGE%"
) else (
  set "TSFG_MESSAGE=locked Node.js closure is missing or invalid; run tsfg-build prefetch"
)
if not defined TSFG_REPORT goto runtime_failure_stderr
for %%D in ("%TSFG_REPORT%") do if not exist "%%~dpD" mkdir "%%~dpD" >nul 2>nul
set "TSFG_REPORT_TEMP=%TSFG_REPORT%.%RANDOM%.tmp"
>"%TSFG_REPORT_TEMP%" echo {"command":"%TSFG_COMMAND%","error":{"category":"lock/integrity","code":"11","issues":[{"code":"runtime-closure","message":"%TSFG_MESSAGE%"}]},"network":"%TSFG_FAILURE_NETWORK%","schemaVersion":"1","status":"failure","telemetry":false}
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
