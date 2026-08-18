<#
.SYNOPSIS
    Wires Project J.K. to a vault: sets the vault path and agent name in AGENTS.md,
    seeds the starter notes, and optionally drops a desktop launcher.

.DESCRIPTION
    Run once, from anywhere. Safe to re-run: it never overwrites a vault note that
    already exists, and it tells you what it skipped.

.EXAMPLE
    pwsh scripts/setup.ps1

.EXAMPLE
    pwsh scripts/setup.ps1 -VaultPath "G:\My Drive\Kevin Jones" -AgentName "J.K." -NoPrompt
#>

[CmdletBinding()]
param(
    [string]$VaultPath,
    [string]$AgentName,
    [switch]$NoPrompt,
    [switch]$SkipLauncher
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$AgentsFile = Join-Path $RepoRoot 'AGENTS.md'
$ClaudeFile = Join-Path $RepoRoot 'CLAUDE.md'

function Write-Step { param($m) Write-Host "  $m" -ForegroundColor Cyan }
function Write-Ok   { param($m) Write-Host "  [ok]   $m" -ForegroundColor Green }
function Write-Skip { param($m) Write-Host "  [skip] $m" -ForegroundColor DarkGray }
function Write-Warn2 { param($m) Write-Host "  [warn] $m" -ForegroundColor Yellow }

Write-Host ""
Write-Host "Project J.K. setup" -ForegroundColor White
Write-Host "------------------" -ForegroundColor White
Write-Host ""

# --- Preflight -------------------------------------------------------------

if (-not (Test-Path $AgentsFile)) {
    throw "AGENTS.md not found at $AgentsFile. Run this from inside the cloned repo."
}

# --- Vault path ------------------------------------------------------------

if (-not $VaultPath) {
    if ($NoPrompt) { throw "-VaultPath is required when -NoPrompt is set." }
    Write-Host "Where does your Obsidian vault live? This becomes the agent's memory."
    Write-Host "Example: G:\My Drive\Kevin Jones"
    $VaultPath = (Read-Host "Vault path").Trim().Trim('"')
}

if (-not (Test-Path -LiteralPath $VaultPath)) {
    throw "No folder at '$VaultPath'. Create the vault in Obsidian first, then re-run."
}
$VaultPath = (Resolve-Path -LiteralPath $VaultPath).Path.TrimEnd('\')
Write-Ok "Vault: $VaultPath"

# --- Agent name ------------------------------------------------------------

if (-not $AgentName) {
    if ($NoPrompt) { $AgentName = 'J.K.' }
    else {
        $AgentName = (Read-Host "What is your agent called? (blank for 'J.K.')").Trim()
        if ([string]::IsNullOrWhiteSpace($AgentName)) { $AgentName = 'J.K.' }
    }
}
Write-Ok "Agent: $AgentName"
Write-Host ""

# --- Patch AGENTS.md -------------------------------------------------------

Write-Step "Updating AGENTS.md"

# Read as UTF-8 explicitly. Windows PowerShell 5.1's Get-Content defaults to the
# system ANSI codepage on a BOM-less file, which silently mangles every non-ASCII
# character (em-dashes become "a€"). .NET's ReadAllText detects UTF-8 properly.
$agents = [System.IO.File]::ReadAllText($AgentsFile)

# Replace the fenced vault path block (the single line inside a ``` fence that
# looks like a filesystem path under "Where your memory lives").
$agents = [regex]::Replace(
    $agents,
    '(?ms)(## Where your memory lives.*?```\r?\n)(.*?)(\r?\n```)',
    { param($m) $m.Groups[1].Value + $VaultPath + $m.Groups[3].Value }
)

if ($AgentName -ne 'J.K.') {
    $agents = $agents -replace '(?<![\w.])J\.K\.(?![\w])', [regex]::Escape($AgentName).Replace('\','')
}

# Windows PowerShell 5.1's `-Encoding utf8` writes a BOM, which shows up as stray
# characters in other tools. Write UTF-8 without one.
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($AgentsFile, $agents, $Utf8NoBom)
Write-Ok "Vault path and agent name written into AGENTS.md"

# CLAUDE.md must stay exactly one line, or content hides from Codex and agy.
[System.IO.File]::WriteAllText($ClaudeFile, "@AGENTS.md`n", $Utf8NoBom)
Write-Ok "CLAUDE.md pinned to '@AGENTS.md'"
Write-Host ""

# --- Seed the vault --------------------------------------------------------

Write-Step "Seeding the vault"

$folders = @(
    '01 - Daily Notes',
    '16 - Personal',
    '17 - Archive',
    '18 - Resources',
    '18 - Resources\Jobs'
)
foreach ($f in $folders) {
    $p = Join-Path $VaultPath $f
    if (Test-Path -LiteralPath $p) { Write-Skip "$f already exists" }
    else { New-Item -ItemType Directory -Path $p -Force | Out-Null; Write-Ok "created $f" }
}

$monthFolder = Join-Path $VaultPath ('01 - Daily Notes\{0:MM} - {0:MMMM yyyy}' -f (Get-Date))
if (-not (Test-Path -LiteralPath $monthFolder)) {
    New-Item -ItemType Directory -Path $monthFolder -Force | Out-Null
    Write-Ok "created $(Split-Path -Leaf $monthFolder)"
}

# Copy starter notes only where nothing is there yet. Never clobber a real note.
$seeds = @{
    'templates\VAULT-INDEX.md' = 'VAULT-INDEX.md'
    'templates\DAILY-NOTE.md'  = '01 - Daily Notes\Daily Note Template.md'
    'templates\JOB.md'         = '18 - Resources\Jobs\_Job Template.md'
}
foreach ($src in $seeds.Keys) {
    $from = Join-Path $RepoRoot $src
    $to   = Join-Path $VaultPath $seeds[$src]
    if (-not (Test-Path -LiteralPath $from)) { Write-Warn2 "missing template: $src"; continue }
    if (Test-Path -LiteralPath $to) { Write-Skip "$($seeds[$src]) already exists, left alone" }
    else { Copy-Item -LiteralPath $from -Destination $to; Write-Ok "seeded $($seeds[$src])" }
}
Write-Host ""

# --- Desktop launcher ------------------------------------------------------

if (-not $SkipLauncher) {
    $makeIt = $true
    if (-not $NoPrompt) {
        $ans = (Read-Host "Drop a 'Chat with $AgentName' shortcut on your Desktop? (Y/n)").Trim()
        if ($ans -match '^[Nn]') { $makeIt = $false }
    }
    if ($makeIt) {
        Write-Step "Creating launcher"
        $safeName = ($AgentName -replace '[\\/:*?"<>|]', '')
        $desktop = [Environment]::GetFolderPath('Desktop')
        $bat = Join-Path $desktop "Chat with $safeName.bat"
        $lines = @(
            '@echo off',
            "title Chat with $safeName",
            "cd /d `"$RepoRoot`"",
            'claude',
            'if errorlevel 1 pause'
        )
        Set-Content -LiteralPath $bat -Value ($lines -join "`r`n") -Encoding ascii
        Write-Ok "Desktop shortcut: $bat"
        Write-Host ""
        Write-Warn2 "Double-click it now to test. Never trust an untested shortcut."
    }
}

# --- Done ------------------------------------------------------------------

Write-Host ""
Write-Host "Done. $AgentName is wired to $VaultPath" -ForegroundColor Green
Write-Host ""
Write-Host "Next: open a terminal here and run 'claude'. Then check three things:" -ForegroundColor White
Write-Host "  1. it opens with its welcome line"
Write-Host "  2. ask 'what is open right now?' - the answer must match Active Priorities.md"
Write-Host "  3. ask it to name a Job - it must be able to state that Job's boot chain"
Write-Host ""
Write-Host "If it answers 2 or 3 without reading the vault, the startup sequence is not"
Write-Host "firing. That is the only failure mode that matters, and it is invisible"
Write-Host "unless you check. See docs/VERIFY.md."
Write-Host ""
