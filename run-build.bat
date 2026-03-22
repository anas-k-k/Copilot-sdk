@echo off
cd /d "C:\Projects\AI\Copilot-sdk"
echo Starting npm install...
call npm install
if errorlevel 1 (
    echo npm install failed
    exit /b 1
)
echo.
echo Starting npm run build...
call npm run build
if errorlevel 1 (
    echo npm run build failed
    exit /b 1
)
echo.
echo Starting npm run test...
call npm run test
if errorlevel 1 (
    echo npm run test failed
    exit /b 1
)
echo.
echo All tasks completed successfully
