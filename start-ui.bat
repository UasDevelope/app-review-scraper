@echo off
cd /d "%~dp0"
echo.
echo  App Review Scraper - Web UI (dev mode, auto-reload)
echo  Open http://localhost:3456 in your browser
echo  Saves to src/ or public/ will restart the server and refresh the page.
echo.
npm run dev
pause
