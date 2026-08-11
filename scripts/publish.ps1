# GitHub Pages へ公開する。gh auth login を済ませてから実行する。
# 使い方: powershell -ExecutionPolicy Bypass -File scripts\publish.ps1

$ErrorActionPreference = 'Stop'
$gh = "$env:ProgramFiles\GitHub CLI\gh.exe"
if (-not (Test-Path $gh)) { $gh = 'gh' }

Set-Location (Split-Path $PSScriptRoot -Parent)

& $gh auth status
if ($LASTEXITCODE -ne 0) {
  Write-Host "先に `"$gh`" auth login を実行してください。" -ForegroundColor Yellow
  exit 1
}

$repo = 'denko2-companion'
$owner = (& $gh api user --jq .login)

# リポジトリが無ければ作る(private でも Pages を使えるかはプランによるので public)
$exists = & $gh repo view "$owner/$repo" --json name 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "リポジトリを作成: $owner/$repo"
  & $gh repo create $repo --public --source . --remote origin --push
} else {
  Write-Host "既存のリポジトリを使う: $owner/$repo"
  if (-not (git remote | Select-String -Quiet '^origin$')) {
    git remote add origin "https://github.com/$owner/$repo.git"
  }
  git push -u origin main
}

# Pages を GitHub Actions ソースで有効化
& $gh api "repos/$owner/$repo/pages" -X POST -f "build_type=workflow" 2>$null
if ($LASTEXITCODE -ne 0) {
  & $gh api "repos/$owner/$repo/pages" -X PUT -f "build_type=workflow" 2>$null
}

Write-Host ""
Write-Host "公開URL: https://$owner.github.io/$repo/" -ForegroundColor Green
Write-Host "デプロイの進捗: " -NoNewline
Write-Host "https://github.com/$owner/$repo/actions" -ForegroundColor Green
