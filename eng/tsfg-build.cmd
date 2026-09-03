@echo off
rem SPDX-License-Identifier: MIT
setlocal EnableExtensions
call :find_report %*
set "TSFG_COMMAND=%~1"
set "TSFG_REPOSITORY=%~dp0.."
set "TSFG_LOCK_ID=120ce553cd29c0cf5584101ec422491570410560797b9ca6e253e79580304291"
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
>"%TSFG_REPORT_TEMP%" echo {"command":"%TSFG_COMMAND%","error":{"category":"lock/integrity","code":"11","issues":[{"code":"runtime-closure","message":"%TSFG_MESSAGE%"}]},"network":"offline","schemaVersion":"1","status":"failure","telemetry":false}
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
