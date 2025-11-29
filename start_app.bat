@echo off
ECHO Starting bunjir-alarm via PM2...

REM Use the correct config file name (.cjs is recommended)
pm2 start E:\Arif\projects\node\bunjir-alarm\ecosystem.config.cjs

ECHO.
ECHO PM2 process started. Check status with: pm2 list
pause