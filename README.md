# 3D Viewer

브라우저에서 STEP, STL, DXF, DWG 등 CAD/3D 파일을 열어보는 뷰어입니다.

## 프로젝트 구조

```
3d-viewer/
├── index.html, app.js, …   # 웹 앱 (GitHub Pages 배포 대상)
├── samples/                # 샘플 DXF 파일 (선택)
├── local/                  # 로컬 전용 Python 서버 + CAD 변환 API
├── portable/               # Windows 포터블 빌드 스크립트
└── .github/workflows/      # GitHub Pages 자동 배포
```

## GitHub Pages 배포

1. GitHub에 새 저장소를 만들고 이 폴더를 푸시합니다.
2. 저장소 **Settings → Pages → Build and deployment**에서 Source를 **GitHub Actions**로 설정합니다.
3. `main`(또는 `master`) 브랜치에 푸시하면 `.github/workflows/pages.yml`이 자동 배포합니다.
4. 배포 URL: `https://<사용자명>.github.io/<저장소명>/`

### GitHub에 처음 올리기

```powershell
cd C:\Users\HP\3d-viewer
git commit -m "Prepare web deployment for GitHub Pages"
git branch -M main
git remote add origin https://github.com/<사용자명>/<저장소명>.git
git push -u origin main
```

푸시 후 **Settings → Pages → Build and deployment**에서 Source를 **GitHub Actions**로 설정하면 `.github/workflows/pages.yml`이 자동 배포합니다.

### 노션에 임베드하기

1. GitHub Pages 배포가 끝난 뒤 배포 URL을 복사합니다. (예: `https://myuser.github.io/3d-viewer/`)
2. 노션 페이지에서 `/embed` 입력 후 URL 붙여넣기.
3. 임베드 높이를 넉넉히 조정합니다 (뷰어 UI가 세로로 길어 최소 700px 권장).

노션 임베드는 iframe 방식이라 **파일 열기(로컬 파일 선택)** 는 정상 동작합니다. 독점 CAD 자동 변환만 웹 버전에서 비활성화됩니다.

### 웹 버전에서 지원하는 형식

- STEP/STP, IGES, BREP, STL, 3MF (3D printing), OBJ, PLY, GLB/GLTF, 3DM, DXF, DWG, AI
- STL/OBJ/PLY/GLB로보내기, 3면도 DXF 생성

### 웹 버전에서 지원하지 않는 기능

- SolidWorks, Inventor, Fusion 360, Creo, CATIA 등 독점 CAD → STEP 자동 변환  
  (로컬 서버 + 설치된 CAD 프로그램 필요)

## 로컬 실행 (전체 기능)

독점 CAD 자동 변환을 쓰려면 Python 서버가 필요합니다.

```bat
local\start.bat
```

또는 프로젝트 루트에서:

```bat
start.bat
```

브라우저에서 `http://localhost:8080` 으로 접속합니다.

## Windows 포터블 빌드

```powershell
.\portable\build.ps1
```

빌드 후 `3D-Viewer-Portable\3D-Viewer.bat`을 실행합니다. (`3D-Viewer-Portable/`은 git에 포함되지 않습니다.)