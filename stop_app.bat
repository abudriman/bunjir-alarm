@echo off
ECHO Stopping bunjir-alarm...

REM The 'stop' command only stops the process but keeps it in the PM2 list.
pm2 stop bunjir-alarm

REM If you want to remove it entirely from PM2's control, use 'delete' instead:
REM pm2 delete bunjir-alarm

ECHO.
ECHO bunjir-alarm has been stopped.
pause