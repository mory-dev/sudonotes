@echo off
setlocal EnableDelayedExpansion

rem Signs one Windows binary with Azure Trusted Signing. Tauri calls this once
rem per artifact (the .exe and each installer) and passes the path as %1.
rem
rem Tauri splits `signCommand` on spaces and runs it directly -- there is no
rem shell, so `%VAR%` in tauri.conf.json would be passed through literally. That
rem is why the credentials are read here instead of there, which also keeps every
rem value out of the committed config.
rem
rem Env vars (all from the repo's .env, which is gitignored):
rem   AZURE_ENDPOINT           e.g. https://eus.codesigning.azure.net
rem   AZURE_ACCOUNT_NAME       Trusted Signing account
rem   AZURE_CERT_PROFILE_NAME  certificate profile within that account
rem   AZURE_CLIENT_ID / AZURE_TENANT_ID / AZURE_CLIENT_SECRET
rem
rem Requires: cargo install artifact-signing-cli

set "FILE=%~1"
if "%FILE%"=="" (
  echo [sign] No file argument given.
  exit /b 1
)

rem Nothing configured at all: a fork or an ordinary local build. Leave the
rem binary unsigned and carry on, matching how Apple signing is optional here.
if "%AZURE_ENDPOINT%%AZURE_ACCOUNT_NAME%%AZURE_CERT_PROFILE_NAME%%AZURE_CLIENT_ID%%AZURE_TENANT_ID%%AZURE_CLIENT_SECRET%"=="" (
  echo [sign] No Azure credentials in the environment - leaving %~nx1 unsigned.
  exit /b 0
)

rem Partly configured is an error, never a silent skip: shipping an unsigned
rem installer while believing it was signed is the failure worth preventing.
set "MISSING="
if "%AZURE_ENDPOINT%"=="" set "MISSING=!MISSING! AZURE_ENDPOINT"
if "%AZURE_ACCOUNT_NAME%"=="" set "MISSING=!MISSING! AZURE_ACCOUNT_NAME"
if "%AZURE_CERT_PROFILE_NAME%"=="" set "MISSING=!MISSING! AZURE_CERT_PROFILE_NAME"
if "%AZURE_CLIENT_ID%"=="" set "MISSING=!MISSING! AZURE_CLIENT_ID"
if "%AZURE_TENANT_ID%"=="" set "MISSING=!MISSING! AZURE_TENANT_ID"
if "%AZURE_CLIENT_SECRET%"=="" set "MISSING=!MISSING! AZURE_CLIENT_SECRET"
if not "!MISSING!"=="" (
  echo [sign] Azure signing is only partly configured. Missing:!MISSING!
  exit /b 1
)

rem artifact-signing-cli picks up AZURE_CLIENT_ID / _TENANT_ID / _CLIENT_SECRET
rem on its own. The account and profile have their own variable names, so map
rem the ones this repo already uses onto them.
set "AZURE_ARTIFACT_SIGNING_ACCOUNT=%AZURE_ACCOUNT_NAME%"
set "AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE=%AZURE_CERT_PROFILE_NAME%"

echo [sign] Signing %~nx1
rem -d names the app in the UAC prompt; without it Windows shows random chars.
artifact-signing-cli -e "%AZURE_ENDPOINT%" -d "sudonotes" "%FILE%"
exit /b %ERRORLEVEL%
