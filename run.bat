@echo off
rem 데자뷰 웹 포팅판 실행: 로컬 서버를 띄우고 브라우저를 연다 (오디오 처리에 http 가 필요)
cd /d "%~dp0"
start "" http://localhost:8765/
python -m http.server 8765
