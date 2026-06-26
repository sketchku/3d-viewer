로컬 전용 — GitHub Pages 배포에 포함되지 않습니다.

start.bat  : 개발용 HTTP 서버 (http://localhost:8080)
serve.py   : 서버 진입점 (프로젝트 루트의 웹 파일 제공)
viewer_server.py : 정적 파일 + /api/convert-step CAD 변환 API
cad_converter.py : SolidWorks/Inventor/CATIA/FreeCAD 변환 백엔드