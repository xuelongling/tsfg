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

if /i "%~1"=="prefetch" (
  node "%~dp0tsfg-build.mjs" %* --lock "%~dp0toolchains.lock.json" --cache "%TSFG_CACHE%" --platform windows-x86_64
  exit /b %errorlevel%
)
if /i not "%~1"=="verify-workspace" goto usage

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
if /i "%~1"=="--report" (
  set "TSFG_REPORT=%~2"
  exit /b 0
)
shift
goto find_report

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
set "TSFG_MESSAGE=unsupported operation"
if not defined TSFG_REPORT goto usage_failure_stderr
for %%D in ("%TSFG_REPORT%") do if not exist "%%~dpD" mkdir "%%~dpD" >nul 2>nul
set "TSFG_REPORT_TEMP=%TSFG_REPORT%.%RANDOM%.tmp"
>"%TSFG_REPORT_TEMP%" echo {"command":"unsupported","error":{"category":"usage/configuration","code":"2","issues":[{"code":"unsupported-operation","message":"unsupported operation"}]},"network":"disabled","schemaVersion":"1","status":"failure","telemetry":false}
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
