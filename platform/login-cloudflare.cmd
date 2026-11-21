@echo off
setlocal
cd /d "D:\Aegishider\platform"
set "NODE=C:\Users\audim_r0h5i\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE%" (
  echo [!] Node runtime not found: %NODE%
  pause
  exit /b 1
)
echo Opening Cloudflare login in your browser...
"%NODE%" "D:\Aegishider\platform\node_modules\wrangler\bin\wrangler.js" login
echo.
echo If login succeeded, go back to the chat and say: login done
pause
