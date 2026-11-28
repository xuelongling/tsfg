@echo off
setlocal
set "TSFG_BIN_DIR=%~dp0"
if defined TSFG_LOCKED_NODE (
  "%TSFG_LOCKED_NODE%" "%TSFG_BIN_DIR%..\tooling\tsfgc.mjs" %*
) else (
  node "%TSFG_BIN_DIR%..\tooling\tsfgc.mjs" %*
)
exit /b %ERRORLEVEL%
