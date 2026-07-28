$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent $PSScriptRoot
$bundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$systemNode = Get-Command node -ErrorAction SilentlyContinue

if (Test-Path -LiteralPath $bundledNode) {
    $nodeExe = $bundledNode
} elseif ($systemNode) {
    $nodeExe = $systemNode.Source
} else {
    Write-Host "没有找到 Node.js。请在 Codex 环境中启动，或先安装 Node.js 22 以上版本。" -ForegroundColor Red
    exit 1
}

Set-Location -LiteralPath $appRoot
Write-Host "正在启动《资本论》通俗新译本地工作台……" -ForegroundColor Cyan
Write-Host "关闭这个窗口即可停止工作台。" -ForegroundColor DarkGray
& $nodeExe (Join-Path $appRoot "scripts\dev.mjs") "--open"
