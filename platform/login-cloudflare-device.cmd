@echo off
setlocal
cd /d "D:\Aegishider\platform"
set "NODE=C:\Users\audim_r0h5i\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE%" (
  echo [!] Node runtime not found: %NODE%
  pause
  exit /b 1
)
echo Opening Cloudflare device login...
echo Copy the code shown below into the browser page.
"%NODE%" "D:\Aegishider\platform\node_modules\wrangler\bin\wrangler.js" login --device
echo.
echo If login succeeded, go back to the chat and say: login done
pause
