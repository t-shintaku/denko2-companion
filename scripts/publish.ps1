# GitHub Pages へ公開する。gh auth login を済ませてから実行する。
# 使い方: powershell -ExecutionPolicy Bypass -File scripts\publish.ps1
#
# 注意: このファイルは UTF-8 (BOM 付き) で保存すること。
# BOM が無いと Windows PowerShell 5.1 が CP932 として読み、日本語を含む行で
# 「文字列に終端記号 " がありません」という構文エラーになる。

# $ErrorActionPreference = 'Stop' にしないこと。
# Windows PowerShell 5.1 では、ネイティブコマンド(gh.exe)が stderr へ出しただけで
# NativeCommandError という終了エラーになり、正常な分岐(リポジトリ未作成の確認など)で落ちる。
# 成否は $LASTEXITCODE で明示的に見る。
$ErrorActionPreference = 'Continue'

$gh = Join-Path $env:ProgramFiles 'GitHub CLI\gh.exe'
if (-not (Test-Path $gh)) { $gh = 'gh' }

Set-Location (Split-Path $PSScriptRoot -Parent)

$null = & $gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host 'GitHub にログインしていません。先に次を実行してください:' -ForegroundColor Yellow
    Write-Host ('  & "{0}" auth login' -f $gh) -ForegroundColor Yellow
    exit 1
}

$repo  = 'denko2-companion'
$owner = (& $gh api user --jq .login)
Write-Host ('アカウント: {0}' -f $owner)

$null = & $gh repo view ('{0}/{1}' -f $owner, $repo) --json name 2>&1
$repoExists = ($LASTEXITCODE -eq 0)

if (-not $repoExists) {
    Write-Host ('リポジトリを作成します: {0}/{1}' -f $owner, $repo)
    & $gh repo create $repo --public --source . --remote origin --push
    if ($LASTEXITCODE -ne 0) { throw 'リポジトリの作成に失敗しました' }
}
else {
    Write-Host ('既存のリポジトリを使います: {0}/{1}' -f $owner, $repo)
    $hasOrigin = (git remote) -contains 'origin'
    if (-not $hasOrigin) {
        git remote add origin ('https://github.com/{0}/{1}.git' -f $owner, $repo)
    }
    git push -u origin main
    if ($LASTEXITCODE -ne 0) { throw 'push に失敗しました' }
}

# Pages を GitHub Actions ソースで有効化する。既に有効なら PUT で更新する。
$pagesPath = 'repos/{0}/{1}/pages' -f $owner, $repo
$null = & $gh api $pagesPath -X POST -f 'build_type=workflow' 2>&1
if ($LASTEXITCODE -ne 0) {
    $null = & $gh api $pagesPath -X PUT -f 'build_type=workflow' 2>&1
}

$url     = 'https://{0}.github.io/{1}/' -f $owner, $repo
$actions = 'https://github.com/{0}/{1}/actions' -f $owner, $repo

Write-Host ''
Write-Host '----------------------------------------'
Write-Host ('公開URL      : {0}' -f $url) -ForegroundColor Green
Write-Host ('ビルドの進捗 : {0}' -f $actions) -ForegroundColor Green
Write-Host '----------------------------------------'
Write-Host 'ビルドに3〜4分かかります。終わってからスマホで公開URLを開いてください。'
