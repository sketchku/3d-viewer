# Create GitHub repo and push (run after: gh auth login)
param(
    [string]$RepoName = '3d-viewer',
    [ValidateSet('public', 'private')]
    [string]$Visibility = 'public'
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot

$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) {
    throw 'GitHub CLI (gh) is not installed. Install with: winget install GitHub.cli'
}

gh auth status 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'GitHub login required.' -ForegroundColor Yellow
    Write-Host 'Run: gh auth login -h github.com -p https -w -s repo,workflow' -ForegroundColor Cyan
    Start-Process 'https://github.com/login/device'
    throw 'Not logged in to GitHub.'
}

Set-Location $Root

if (-not (git rev-parse --is-inside-work-tree 2>$null)) {
    git init
    git branch -M main
}

$status = git status --porcelain
if ($status) {
    git add -A
    git commit -m "Prepare web deployment for GitHub Pages"
}

$hasOrigin = $false
try {
    $null = git remote get-url origin 2>$null
    if ($LASTEXITCODE -eq 0) { $hasOrigin = $true }
} catch {
    $hasOrigin = $false
}

if (-not $hasOrigin) {
    Write-Host "Creating repo: $RepoName ($Visibility)" -ForegroundColor Cyan
    gh repo create $RepoName --$Visibility --source . --remote origin --push
} elseif ($hasOrigin) {
    Write-Host 'Pushing to existing remote origin...' -ForegroundColor Cyan
    git push -u origin main
}

$user = gh api user --jq .login
$pagesUrl = "https://$user.github.io/$RepoName/"

Write-Host ''
Write-Host 'Done!' -ForegroundColor Green
Write-Host "Repository: https://github.com/$user/$RepoName"
Write-Host "Pages URL (after deploy): $pagesUrl"
Write-Host ''
Write-Host 'Enable Pages: GitHub repo -> Settings -> Pages -> Source: GitHub Actions' -ForegroundColor Yellow