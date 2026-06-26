# Build portable 3D File Viewer package for Windows x64
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$PortableRoot = Join-Path $Root '3D-Viewer-Portable'
$RuntimeDir = Join-Path $PortableRoot 'runtime'
$AppDir = Join-Path $PortableRoot 'app'
$PythonVersion = '3.12.10'
$PythonZip = "python-$PythonVersion-embed-amd64.zip"
$PythonUrl = "https://www.python.org/ftp/python/$PythonVersion/$PythonZip"
$TempDir = Join-Path $env:TEMP "3d-viewer-portable-build"

Write-Host '=== 3D File Viewer Portable Build ===' -ForegroundColor Cyan

if (Test-Path $PortableRoot) {
    Remove-Item $PortableRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
New-Item -ItemType Directory -Path $AppDir -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $PortableRoot 'data') -Force | Out-Null

# Copy app files
$Include = @('index.html', 'app.js', 'i18n.js', 'i18n-boot.js', 'styles.css', 'bg-pixels.js', 'web-config.js', 'cad2d-loader.js', 'drawing-export.js', 'viewer-features.js', 'recent-files.js', 'part-tree.js', 'large-file-loader.js', 'rhino-loader.js', 'cad-format-guide.js', 'cad-step-convert.js')
foreach ($file in $Include) {
    Copy-Item (Join-Path $Root $file) (Join-Path $AppDir $file) -Force
}

# Samples (skip very large test files)
$SamplesSrc = Join-Path $Root 'samples'
$SamplesDst = Join-Path $AppDir 'samples'
if (Test-Path $SamplesSrc) {
    New-Item -ItemType Directory -Path $SamplesDst -Force | Out-Null
    Get-ChildItem $SamplesSrc -File | Where-Object { $_.Length -lt 5MB } | Copy-Item -Destination $SamplesDst -Force
}

$LocalDir = Join-Path $Root 'local'
Copy-Item (Join-Path $PSScriptRoot 'launcher.py') (Join-Path $PortableRoot 'launcher.py') -Force
Copy-Item (Join-Path $LocalDir 'cad_converter.py') (Join-Path $PortableRoot 'cad_converter.py') -Force
Copy-Item (Join-Path $LocalDir 'viewer_server.py') (Join-Path $PortableRoot 'viewer_server.py') -Force

# Download Python embeddable (stdlib only; no pip/packages required)
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
$ZipPath = Join-Path $TempDir $PythonZip
if (-not (Test-Path $ZipPath)) {
    Write-Host "Downloading $PythonZip ..."
    Invoke-WebRequest -Uri $PythonUrl -OutFile $ZipPath
}
Expand-Archive -Path $ZipPath -DestinationPath $RuntimeDir -Force

# Launchers
@'
@echo off
title 3D File Viewer
cd /d "%~dp0"
if not exist "runtime\pythonw.exe" (
    echo Portable runtime is missing. Run portable\build.ps1 first.
    pause
    exit /b 1
)
start "" "%~dp0runtime\pythonw.exe" "%~dp0launcher.py"
'@ | Set-Content (Join-Path $PortableRoot '3D-Viewer.bat') -Encoding ASCII

@'
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.Run """" & WshShell.CurrentDirectory & "\runtime\pythonw.exe"" """ & WshShell.CurrentDirectory & "\launcher.py""", 0, False
'@ | Set-Content (Join-Path $PortableRoot '3D-Viewer.vbs') -Encoding ASCII

@'
3D File Viewer (Portable)
=========================

[실행 방법]
  - 3D-Viewer.bat 더블클릭
  - 또는 3D-Viewer.vbs (콘솔 창 없이 실행)

[포터블 사용]
  - 이 폴더 전체를 USB 등에 복사해 어디서든 실행할 수 있습니다.
  - Windows 10/11 x64 필요
  - Microsoft Edge 또는 Google Chrome 필요 (앱 창 모드로 실행)

[인터넷]
  - Three.js CDN 및 STEP/DXF 라이브러리 로드를 위해 인터넷 연결이 필요합니다.

[구성]
  app/      뷰어 웹 파일
  runtime/  내장 Python (별도 설치 불필요)
  data/     브라우저 프로필 및 로그 (자동 생성)

[종료]
  - 뷰어 창을 닫으면 서버도 함께 종료됩니다.

[재빌드]
  portable\build.ps1 실행
'@ | Set-Content (Join-Path $PortableRoot 'README.txt') -Encoding UTF8

Write-Host "Done: $PortableRoot" -ForegroundColor Green
Write-Host 'Run 3D-Viewer.bat to start.' -ForegroundColor Green