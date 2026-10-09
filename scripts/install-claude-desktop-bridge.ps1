$ErrorActionPreference = 'Stop'
$trackerRoot = Split-Path -Parent $PSScriptRoot
$pluginRoot = Join-Path $trackerRoot 'claude-plugin'
$claudeCli = Get-ChildItem -Path "$env:APPDATA/Claude/claude-code/*/*/claude.exe" -ErrorAction SilentlyContinue |
    Sort-Object { [version]$_.Directory.Parent.Name } | Select-Object -Last 1
if (-not $claudeCli) { throw 'Open or update Claude Desktop first; its local Code runtime was not found.' }
if ([version]$claudeCli.Directory.Parent.Name -lt [version]'2.1.287') { throw 'Update Claude Desktop: the quota bridge requires Claude Code 2.1.287 or newer.' }
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw 'Node.js is required by AI Usage Tracker. Install Node 24 and retry.' }
& $claudeCli.FullName plugin validate (Join-Path $pluginRoot 'quota-bridge') --strict
if ($LASTEXITCODE -ne 0) { throw 'Claude rejected the quota bridge. No settings were changed.' }
& $claudeCli.FullName plugin marketplace add $pluginRoot
if ($LASTEXITCODE -ne 0) { throw 'Could not register the local quota bridge marketplace.' }
& $claudeCli.FullName plugin install 'ai-usage-tracker-bridge@ai-usage-tracker-local' --scope user
if ($LASTEXITCODE -ne 0) { throw 'Could not install the quota bridge.' }
& $claudeCli.FullName plugin update 'ai-usage-tracker-bridge@ai-usage-tracker-local'
if ($LASTEXITCODE -ne 0) { throw 'Could not refresh the installed quota bridge version.' }
& $nodeCommand.Source (Join-Path $trackerRoot 'tools/enable-claude-desktop.ts')
if ($LASTEXITCODE -ne 0) { throw 'Bridge installed, but tracker setup needs repair. Retry after checking Claude settings.' }
