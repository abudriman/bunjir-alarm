@echo off
ECHO Starting bunjir-alarm via PM2...

REM Use the correct config file name (.cjs is recommended)
pm2 start bunjir-alarm

ECHO.
ECHO PM2 process started. Check status with: pm2 list
pause