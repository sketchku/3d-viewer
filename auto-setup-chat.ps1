# Auto-provision shared visitor chat (Telegraph API — no Google/Firebase login required)
$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$ConfigPath = Join-Path $Root 'chat-config.js'

Write-Host '=== Auto Visitor Chat Setup ===' -ForegroundColor Cyan

$account = Invoke-RestMethod -Method Post -Uri 'https://api.telegra.ph/createAccount' -Body @{
  short_name = 'sk3dviewer'
  author_name = '3D Viewer'
}

$token = $account.result.access_token
if (-not $token) { throw 'Failed to create Telegraph account' }

$initialContent = '[{"tag":"pre","children":["[]"]}]'
$page = Invoke-RestMethod -Method Post -Uri 'https://api.telegra.ph/createPage' -Body @{
  access_token = $token
  title = '3D Viewer Visitor Chat'
  author_name = '3D Viewer'
  content = $initialContent
}

$path = $page.result.path
$url = $page.result.url
if (-not $path) { throw 'Failed to create Telegraph page' }

$content = @"
/**
 * Visitor chat — auto-provisioned shared storage (Telegraph API).
 * Re-run auto-setup-chat.ps1 to reset.
 */
export const CHAT_CONFIG = {
  storage: 'telegraph',
  maxMessages: 300,
  telegraph: {
    accessToken: '$token',
    pagePath: '$path',
    pageUrl: '$url',
  },
  firebase: {
    apiKey: '',
    authDomain: '',
    databaseURL: '',
    projectId: '',
  },
};
"@

Set-Content -Path $ConfigPath -Value $content -Encoding UTF8
Write-Host "Chat page: $url" -ForegroundColor Green
Write-Host "Updated: $ConfigPath" -ForegroundColor Green