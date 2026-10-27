@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 24 or newer from https://nodejs.org/en/download and run this file again.
  pause
  exit /b 1
)
node -e "if (Number(process.versions.node.split('.')[0]) < 24) process.exit(1)"
if errorlevel 1 (
  echo Node.js 24 or newer is required.
  pause
  exit /b 1
)
set "EBAY_CHROME_BIN=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%EBAY_CHROME_BIN%" set "EBAY_CHROME_BIN=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%EBAY_CHROME_BIN%" set "EBAY_CHROME_BIN=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not exist "%EBAY_CHROME_BIN%" (
  echo Google Chrome was not found. Install Chrome and run this file again.
  pause
  exit /b 1
)
call npm ci --ignore-scripts
if errorlevel 1 (
  pause
  exit /b 1
)
call npm run build
if errorlevel 1 (
  pause
  exit /b 1
)
start "" "%EBAY_CHROME_BIN%" --remote-debugging-address=127.0.0.1 --remote-debugging-port=9333 --user-data-dir="%LOCALAPPDATA%\EbayScraperChrome" https://www.ebay.co.uk
echo Sign into eBay in the separate Chrome window, then return here and press any key.
pause >nul
set "EBAY_CHROME_CDP=http://127.0.0.1:9333"
set "EBAY_TRANSPORT=chrome"
set "HOST=127.0.0.1"
set "PORT=3001"
echo Once the server is listening, open this address in your browser:
echo http://127.0.0.1:3001/v1/ebay/completed?query=chesterfield+captain+chairs^&domain=co.uk
call npm start
if errorlevel 1 pause
