@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.13 이상이 필요해요. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해 주세요.
  pause
  exit /b 1
)
if not exist node_modules (
  echo 처음 실행이라 필요한 패키지를 설치해요...
  call npm install
  if errorlevel 1 ( echo 설치에 실패했어요. & pause & exit /b 1 )
)
if not exist data ( echo 샘플 가족 데이터를 만들어요... & call npm run seed )
echo.
echo 브라우저에서 http://localhost:3000 을 열어 주세요. (끝내려면 이 창에서 Ctrl+C)
call npm start
pause
