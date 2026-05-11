@echo off
chcp 65001 > nul
echo ========================================
echo  会計管理システム 起動中...
echo ========================================
echo.
echo ANTHROPIC_API_KEYを設定してください（レシートOCR用）
echo 例: set ANTHROPIC_API_KEY=sk-ant-xxxxxxxxx
echo.
set /p ANTHROPIC_API_KEY="APIキーを入力（スキップする場合はEnter）: "
echo.
echo ブラウザで http://localhost:3000 を開いてください
echo 終了するには Ctrl+C を押してください
echo.
cd /d "%~dp0"
node server.js
pause
