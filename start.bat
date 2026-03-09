@echo off
echo Starting Brave Browser with remote debugging...
start "" "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe" --remote-debugging-port=9222

echo Waiting for Brave to start...
timeout /t 3 /nobreak >nul

echo Installing dependencies...
call npm install

echo Starting LinkedIn Automation...
call npm start

pause
