@echo off
REM PicklePro AI - Installation Helper Script
REM This script installs npm dependencies and prepares the project

echo.
echo ================================================
echo PicklePro AI - Project Setup
echo ================================================
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed or not in PATH
    echo.
    echo Please install Node.js from https://nodejs.org/
    echo After installation, restart your terminal and run this script again.
    echo.
    pause
    exit /b 1
)

echo Node.js is installed
node --version
echo.

REM Check npm
npm --version
echo.

REM Install dependencies
echo Installing dependencies...
echo.
call npm install

if errorlevel 1 (
    echo.
    echo ERROR: Failed to install dependencies
    pause
    exit /b 1
)

echo.
echo ================================================
echo Installation completed successfully!
echo ================================================
echo.
echo To start the development server, run:
echo   npm run dev
echo.
echo The project will be available at http://localhost:3000
echo.
pause
