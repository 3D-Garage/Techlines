[CmdletBinding()]
param(
  [switch]$Force,
  [switch]$SkipMongoInstall,
  [switch]$SkipDependencies,
  [switch]$SkipSeed
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$environmentPath = Join-Path $repositoryRoot ".env"

function Write-Step {
  param([string]$Message)
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function New-RandomBase64 {
  param([int]$ByteCount)

  $buffer = New-Object byte[] $ByteCount
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($buffer)
  } finally {
    $generator.Dispose()
  }
  return [Convert]::ToBase64String($buffer)
}

function Test-LocalMongoPort {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $connection = $client.BeginConnect("127.0.0.1", 27017, $null, $null)
    if (-not $connection.AsyncWaitHandle.WaitOne(1000, $false)) {
      return $false
    }
    $client.EndConnect($connection)
    return $true
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Wait-ForLocalMongoDb {
  param([int]$TimeoutSeconds = 60)

  for ($second = 0; $second -lt $TimeoutSeconds; $second++) {
    if (Test-LocalMongoPort) {
      return
    }
    Start-Sleep -Seconds 1
  }
  throw "MongoDB did not start on 127.0.0.1:27017 within $TimeoutSeconds seconds."
}

function Ensure-NodeJs {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $node -or -not $npm) {
    throw "Node.js 18 or newer is required. Install the current Node.js LTS release, then run this setup again."
  }

  $nodeVersion = (& $node.Source --version).TrimStart("v")
  $nodeMajor = [int]($nodeVersion.Split(".")[0])
  if ($nodeMajor -lt 18) {
    throw "Node.js 18 or newer is required. Current version: $nodeVersion."
  }
  Write-Host "Node.js $nodeVersion detected."
}

function Ensure-LocalMongoDb {
  if (Test-LocalMongoPort) {
    Write-Host "MongoDB is already listening on 127.0.0.1:27017."
    return
  }

  $mongoService = Get-Service -Name "MongoDB" -ErrorAction SilentlyContinue
  if ($mongoService) {
    Write-Host "Starting the existing MongoDB Windows service..."
    Start-Service -Name "MongoDB"
    Wait-ForLocalMongoDb
    return
  }

  if ($SkipMongoInstall) {
    throw "MongoDB is not running and -SkipMongoInstall was specified."
  }

  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if (-not $winget) {
    throw "Windows Package Manager (winget) is required to install MongoDB automatically. Install App Installer or MongoDB Community Server manually."
  }

  Write-Host "Installing MongoDB Community Server with winget. Windows may request administrator approval."
  & $winget.Source install --id MongoDB.Server --exact --source winget --silent --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    throw "MongoDB installation failed with winget exit code $LASTEXITCODE."
  }

  $mongoService = Get-Service -Name "MongoDB" -ErrorAction SilentlyContinue
  if (-not $mongoService) {
    throw "MongoDB was installed, but its Windows service could not be found. Restart Windows and run this setup again."
  }
  if ($mongoService.Status -ne "Running") {
    Start-Service -Name "MongoDB"
  }
  Wait-ForLocalMongoDb
}

function Initialize-EnvironmentFile {
  if ((Test-Path -LiteralPath $environmentPath) -and -not $Force) {
    Write-Host ".env already exists; keeping the current file. Use -Force to replace it with a backed-up generated file."
    return $null
  }

  if (Test-Path -LiteralPath $environmentPath) {
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupPath = Join-Path $repositoryRoot ".env.backup-$timestamp"
    Copy-Item -LiteralPath $environmentPath -Destination $backupPath
    Write-Host "Existing .env backed up to $backupPath"
  }

  $tokenSecret = New-RandomBase64 -ByteCount 48
  $passwordToken = (New-RandomBase64 -ByteCount 12).Replace("+", "A").Replace("/", "B").TrimEnd("=")
  $adminPassword = "Dev-$passwordToken!"

  $content = @"
MONGO_URI=mongodb://127.0.0.1:27017/techlines
TOKEN_SECRET=$tokenSecret
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com
CORS_ORIGIN=http://localhost:3000
PORT=5000
SEED_ADMIN_NAME=Local Admin
SEED_ADMIN_EMAIL=admin@3dgarage.local
SEED_ADMIN_PASSWORD=$adminPassword
"@

  $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($environmentPath, "$content`r`n", $utf8WithoutBom)
  Write-Host "Created $environmentPath"
  return $adminPassword
}

Push-Location $repositoryRoot
try {
  Write-Step "Checking prerequisites"
  Ensure-NodeJs

  Write-Step "Preparing local environment configuration"
  $generatedAdminPassword = Initialize-EnvironmentFile

  Write-Step "Preparing local MongoDB"
  Ensure-LocalMongoDb
  Write-Host "MongoDB is ready on mongodb://127.0.0.1:27017."

  if (-not $SkipDependencies) {
    Write-Step "Installing server and client dependencies"
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw "Root dependency installation failed." }
    & npm.cmd ci --prefix client
    if ($LASTEXITCODE -ne 0) { throw "Client dependency installation failed." }
  }

  if (-not $SkipSeed) {
    Write-Step "Creating collections, indexes, admin user, and sample products"
    & npm.cmd run seed
    if ($LASTEXITCODE -ne 0) { throw "Database seeding failed." }
  }

  Write-Step "Development environment is ready"
  Write-Host "Start the application with: npm run app" -ForegroundColor Green
  Write-Host "Admin email: admin@3dgarage.local"
  if ($generatedAdminPassword) {
    Write-Host "Admin password: $generatedAdminPassword"
    Write-Host "The generated password is also stored only in your local .env file."
  } else {
    Write-Host "The admin password is read from SEED_ADMIN_PASSWORD in your existing .env file."
  }
  Write-Host "PayPal checkout remains disabled until sandbox credentials are added to .env."
} finally {
  Pop-Location
}
