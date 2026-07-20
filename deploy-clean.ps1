# Colossus Web — clean FTP deployment (domainfactory / futuremagic.de)
#
# Builds web/, wipes the remote app directory, creates any missing remote
# directories (including the deploy root), uploads dist/, then writes
# .deploy/manifest.json so .\deploy-sync.ps1 can do incremental deploys next.
#
# Usage (from repo root):
#   .\deploy-clean.ps1
#   .\deploy-clean.ps1 -RemotePath "/webseiten/ColossusWeb/" -BasePath "/ColossusWeb/"
#   .\deploy-clean.ps1 -SkipClean   # upload without wiping remote first
#
# Password: $env:FTP_PASSWORD, or User env FTP_PASSWORD, or interactive prompt.

param(
    [string]$FtpServer = "ftp.futuremagic.de",
    [string]$FtpUser = "12529-Pyrion",
    [string]$RemotePath = "/webseiten/ColossusWeb/",
    [string]$BasePath = "/ColossusWeb/",
    [string]$PublicUrl = "https://futuremagic.de/ColossusWeb/",
    [switch]$SkipClean
)

$ErrorActionPreference = "Stop"

$RepoRoot = $PSScriptRoot
$WebDir = Join-Path $RepoRoot "web"
$DistDir = Join-Path $WebDir "dist"
$DeployDir = Join-Path $RepoRoot ".deploy"
$ManifestPath = Join-Path $DeployDir "manifest.json"

function Normalize-FtpDir([string]$path) {
    $p = $path.Replace('\', '/')
    if (-not $p.StartsWith('/')) { $p = "/$p" }
    if (-not $p.EndsWith('/')) { $p = "$p/" }
    return $p
}

function Normalize-WebBase([string]$path) {
    $p = $path.Replace('\', '/')
    if (-not $p.StartsWith('/')) { $p = "/$p" }
    if (-not $p.EndsWith('/')) { $p = "$p/" }
    return $p
}

$RemotePath = Normalize-FtpDir $RemotePath
$BasePath = Normalize-WebBase $BasePath

Write-Host "Starting COMPLETE CLEAN Colossus deployment..." -ForegroundColor Red
if (-not $SkipClean) {
    Write-Host "This will delete ALL files under remote $RemotePath" -ForegroundColor Yellow
} else {
    Write-Host "SkipClean: remote wipe disabled; directories will still be created as needed." -ForegroundColor Yellow
}
Write-Host "Vite base: $BasePath" -ForegroundColor Cyan
Write-Host "Public URL: $PublicUrl" -ForegroundColor Cyan

function Get-FtpPassword {
    $password = $env:FTP_PASSWORD
    if (-not $password) {
        try {
            $password = [Environment]::GetEnvironmentVariable("FTP_PASSWORD", "User")
            if ($password) {
                Write-Host "Retrieved password from user environment variables" -ForegroundColor Green
                $env:FTP_PASSWORD = $password
            }
        } catch {
            # ignore
        }
    }
    if (-not $password) {
        Write-Host "Enter FTP password:" -ForegroundColor Yellow
        $secure = Read-Host -AsSecureString
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try {
            $password = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
        } finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        }
    } else {
        Write-Host "Using stored password" -ForegroundColor Green
    }
    if (-not $password) {
        throw "FTP password is required"
    }
    return $password
}

function New-FtpRequest([string]$Uri, [string]$Method, [string]$Password) {
    $req = [System.Net.FtpWebRequest]::Create($Uri)
    $req.Method = $Method
    $req.Credentials = New-Object System.Net.NetworkCredential($FtpUser, $Password)
    $req.UseBinary = $true
    $req.UsePassive = $true
    $req.KeepAlive = $false
    $req.Timeout = 300000
    return $req
}

function Test-FtpDirectory([string]$RemoteDir, [string]$Password) {
    try {
        $req = New-FtpRequest "ftp://$FtpServer$RemoteDir" ([System.Net.WebRequestMethods+Ftp]::ListDirectory) $Password
        $resp = $req.GetResponse()
        $resp.Close()
        return $true
    } catch {
        return $false
    }
}

# Many hosts hide dotfiles from NLST/LIST and reject SIZE; fall back to a download probe.
function Test-FtpFileExists([string]$RemoteFile, [string]$Password) {
    $remoteFile = $RemoteFile.Replace('\', '/')
    $lastSlash = $remoteFile.LastIndexOf('/')
    if ($lastSlash -lt 0) { return $false }
    $parent = $remoteFile.Substring(0, $lastSlash + 1)
    $name = $remoteFile.Substring($lastSlash + 1)
    if (-not $name) { return $false }

    try {
        $req = New-FtpRequest "ftp://$FtpServer$parent" ([System.Net.WebRequestMethods+Ftp]::ListDirectory) $Password
        $resp = $req.GetResponse()
        $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $listing = $reader.ReadToEnd()
        $reader.Close()
        $resp.Close()

        foreach ($line in $listing.Split([Environment]::NewLine, [StringSplitOptions]::RemoveEmptyEntries)) {
            $token = $line.Trim()
            if (-not $token) { continue }
            if ($token -eq $name) { return $true }
            $parts = $token.Split(' ', [StringSplitOptions]::RemoveEmptyEntries)
            if ($parts.Length -gt 0 -and $parts[-1] -eq $name) { return $true }
        }
    } catch {
        # fall through to download probe
    }

    # Dotfiles (e.g. .htaccess) often omit from listings — prove existence by opening the file
    try {
        $dl = New-FtpRequest "ftp://$FtpServer$remoteFile" ([System.Net.WebRequestMethods+Ftp]::DownloadFile) $Password
        $dlResp = $dl.GetResponse()
        $stream = $dlResp.GetResponseStream()
        if ($stream) { $stream.Close() }
        $dlResp.Close()
        return $true
    } catch {
        return $false
    }
}

# Create a single FTP directory (no-op if it already exists).
function Ensure-FtpDirectory([string]$RemoteDir, [string]$Password, [System.Collections.Generic.HashSet[string]]$Created) {
    $dir = Normalize-FtpDir $RemoteDir
    if ($Created.Contains($dir)) { return }
    if (Test-FtpDirectory $dir $Password) {
        [void]$Created.Add($dir)
        return
    }
    try {
        $req = New-FtpRequest "ftp://$FtpServer$dir" ([System.Net.WebRequestMethods+Ftp]::MakeDirectory) $Password
        $resp = $req.GetResponse()
        $resp.Close()
        Write-Host "Created directory: $dir" -ForegroundColor Blue
    } catch {
        # Race / already exists after check
        if (-not (Test-FtpDirectory $dir $Password)) {
            throw "Could not create FTP directory $dir : $($_.Exception.Message)"
        }
    }
    [void]$Created.Add($dir)
}

# Ensure every path segment exists, e.g. /webseiten/ and /webseiten/Colossus/
function Ensure-FtpPathTree([string]$RemoteDir, [string]$Password, [System.Collections.Generic.HashSet[string]]$Created) {
    $dir = Normalize-FtpDir $RemoteDir
    $parts = $dir.Trim('/').Split('/', [StringSplitOptions]::RemoveEmptyEntries)
    $current = "/"
    foreach ($part in $parts) {
        $current = "$current$part/"
        Ensure-FtpDirectory $current $Password $Created
    }
}

function Remove-FtpDirectoryContents {
    param(
        [string]$RemoteDir,
        [string]$Password
    )

    $dir = Normalize-FtpDir $RemoteDir
    try {
        $listRequest = New-FtpRequest "ftp://$FtpServer$dir" ([System.Net.WebRequestMethods+Ftp]::ListDirectoryDetails) $Password
        $response = $listRequest.GetResponse()
        $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
        $listing = $reader.ReadToEnd()
        $reader.Close()
        $response.Close()
    } catch {
        Write-Host "Could not list directory $dir (may be empty/new): $($_.Exception.Message)" -ForegroundColor Gray
        return
    }

    $lines = $listing.Split([Environment]::NewLine, [StringSplitOptions]::RemoveEmptyEntries)
    foreach ($line in $lines) {
        if (-not $line.Trim() -or $line.StartsWith("total")) { continue }
        $parts = $line.Split(' ', [StringSplitOptions]::RemoveEmptyEntries)
        if ($parts.Length -eq 0) { continue }
        $fileName = $parts[-1]
        if (-not $fileName -or $fileName -eq "." -or $fileName -eq "..") { continue }

        $isDirectory = $line.StartsWith("d") -or $line -match "^d"
        # Some servers use Windows-style listings; treat `<DIR>` as directory
        if ($line -match "<DIR>") { $isDirectory = $true }

        $fullPath = "$dir$fileName"
        if ($isDirectory) {
            Write-Host "Removing directory: $fileName" -ForegroundColor Red
            Remove-FtpDirectoryContents -RemoteDir "$fullPath/" -Password $Password
            try {
                $rm = New-FtpRequest "ftp://$FtpServer$fullPath" ([System.Net.WebRequestMethods+Ftp]::RemoveDirectory) $Password
                $rmResp = $rm.GetResponse()
                $rmResp.Close()
            } catch {
                Write-Host "Could not remove directory $fileName" -ForegroundColor Gray
            }
        } else {
            Write-Host "Removing file: $fileName" -ForegroundColor Red
            try {
                $del = New-FtpRequest "ftp://$FtpServer$fullPath" ([System.Net.WebRequestMethods+Ftp]::DeleteFile) $Password
                $delResp = $del.GetResponse()
                $delResp.Close()
            } catch {
                Write-Host "Could not remove file $fileName" -ForegroundColor Gray
            }
        }
    }
}

function Get-FileSha256Hex([string]$Path) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $stream = [System.IO.File]::OpenRead($Path)
        try {
            $hash = $sha.ComputeHash($stream)
            return ([System.BitConverter]::ToString($hash) -replace '-', '').ToLowerInvariant()
        } finally {
            $stream.Close()
        }
    } finally {
        $sha.Dispose()
    }
}

function Write-DeployManifest([string]$Path, [hashtable]$FilesMap, [string]$Remote, [string]$Base) {
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    $filesObj = [ordered]@{}
    foreach ($key in ($FilesMap.Keys | Sort-Object)) {
        $entry = $FilesMap[$key]
        $filesObj[$key] = [ordered]@{
            sha256 = $entry.sha256
            size   = $entry.size
        }
    }
    $doc = [ordered]@{
        remotePath = $Remote
        basePath   = $Base
        updatedAt  = (Get-Date).ToUniversalTime().ToString('o')
        files      = $filesObj
    }
    $json = $doc | ConvertTo-Json -Depth 6
    $tmp = "$Path.tmp"
    Set-Content -Path $tmp -Value $json -Encoding UTF8
    Move-Item -Path $tmp -Destination $Path -Force
}

try {
    if (-not (Test-Path $WebDir)) {
        throw "Web app folder not found: $WebDir"
    }

    Write-Host "Cleaning build folder..." -ForegroundColor Yellow
    if (Test-Path $DistDir) {
        Remove-Item -Recurse -Force $DistDir
    }

    Write-Host "Building Colossus (base=$BasePath)..." -ForegroundColor Yellow
    Push-Location $WebDir
    try {
        $env:COLOSSUS_BASE = $BasePath
        npm run build
        if ($LASTEXITCODE -ne 0) {
            throw "npm run build failed with exit code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }

    Write-Host "Copying .htaccess..." -ForegroundColor Yellow
    $htaccessSrc = Join-Path $WebDir "public\.htaccess"
    if (Test-Path $htaccessSrc) {
        $htaccessBody = Get-Content -Raw $htaccessSrc
        $htaccessBody = $htaccessBody -replace '(?m)^(\s*RewriteBase\s+)\S+', "`${1}$BasePath"
        Set-Content -Path (Join-Path $DistDir ".htaccess") -Value $htaccessBody -NoNewline
    } else {
        Write-Host "No public/.htaccess found - skipping" -ForegroundColor Gray
    }

    if (-not (Test-Path (Join-Path $DistDir "index.html"))) {
        throw "Build failed - no index.html in dist"
    }

    $criticalFiles = @(
        "index.html",
        "favicon.svg"
    )
    if (Test-Path (Join-Path $DistDir ".htaccess")) {
        $criticalFiles += ".htaccess"
    }
    # Variant data must be present for the app to boot
    $variantJson = "variants/Default/variant.json"
    $criticalFiles += $variantJson

    foreach ($rel in $criticalFiles) {
        $local = Join-Path $DistDir ($rel.Replace('/', [IO.Path]::DirectorySeparatorChar))
        if (-not (Test-Path $local)) {
            throw "Critical file missing after build: $rel"
        }
    }

    $files = @(Get-ChildItem -Path $DistDir -Recurse -File -Force)
    $totalFiles = $files.Count
    Write-Host "Preparing to upload $totalFiles files..." -ForegroundColor Cyan

    $FTP_PASSWORD = Get-FtpPassword
    $createdDirs = New-Object 'System.Collections.Generic.HashSet[string]'

    # Always ensure the deploy root and all parent segments exist
    Write-Host "Ensuring remote path exists: $RemotePath" -ForegroundColor Cyan
    Ensure-FtpPathTree $RemotePath $FTP_PASSWORD $createdDirs

    if (-not $SkipClean) {
        Write-Host "COMPLETELY CLEANING remote directory..." -ForegroundColor Red
        Remove-FtpDirectoryContents -RemoteDir $RemotePath -Password $FTP_PASSWORD
        # Re-ensure root after wipe (wipe does not remove the root itself)
        Ensure-FtpPathTree $RemotePath $FTP_PASSWORD $createdDirs
    }

    # Pre-create every nested directory needed by the upload set
    Write-Host "Ensuring remote directories for upload tree..." -ForegroundColor Cyan
    $dirSet = New-Object 'System.Collections.Generic.HashSet[string]'
    $distResolved = (Resolve-Path $DistDir).Path
    foreach ($file in $files) {
        $relativePath = $file.FullName.Substring($distResolved.Length).TrimStart([char]'\', [char]'/').Replace('\', '/')
        $slash = $relativePath.LastIndexOf('/')
        if ($slash -gt 0) {
            $relDir = $relativePath.Substring(0, $slash)
            [void]$dirSet.Add($relDir)
        }
    }
    foreach ($relDir in ($dirSet | Sort-Object { $_.Length }, { $_ })) {
        Ensure-FtpPathTree "$RemotePath$relDir/" $FTP_PASSWORD $createdDirs
    }

    Write-Host "Uploading fresh files..." -ForegroundColor Green
    $uploaded = 0
    $failed = @()

    foreach ($file in $files) {
        $relativePath = $file.FullName.Substring($distResolved.Length).TrimStart([char]'\', [char]'/').Replace('\', '/')
        $remoteFile = "$RemotePath$relativePath"

        try {
            $ftpRequest = New-FtpRequest "ftp://$FtpServer$remoteFile" ([System.Net.WebRequestMethods+Ftp]::UploadFile) $FTP_PASSWORD
            $fileContent = [System.IO.File]::ReadAllBytes($file.FullName)
            $ftpRequest.ContentLength = $fileContent.Length
            $requestStream = $ftpRequest.GetRequestStream()
            $requestStream.Write($fileContent, 0, $fileContent.Length)
            $requestStream.Close()
            $response = $ftpRequest.GetResponse()
            $response.Close()

            $uploaded++
            $sizeKB = [math]::Round($fileContent.Length / 1KB, 1)
            Write-Host ("Uploaded: {0} ({1} KB)" -f $relativePath, $sizeKB) -ForegroundColor Green
        } catch {
            $failed += $relativePath
            Write-Host ("Failed: {0} - {1}" -f $relativePath, $_.Exception.Message) -ForegroundColor Red
        }
    }

    Write-Host ""
    Write-Host "=== DEPLOYMENT VERIFICATION ===" -ForegroundColor Cyan
    foreach ($criticalFile in $criticalFiles) {
        $remoteCritical = "$RemotePath$criticalFile"
        if (Test-FtpFileExists $remoteCritical $FTP_PASSWORD) {
            Write-Host ("[OK] {0}" -f $criticalFile) -ForegroundColor Green
        } else {
            Write-Host ("[FAIL] {0} MISSING at {1}" -f $criticalFile, $remoteCritical) -ForegroundColor Red
            $failed += $criticalFile
        }
    }

    if ($failed.Count -gt 0) {
        Write-Host ""
        Write-Host "=== FAILED UPLOADS ===" -ForegroundColor Red
        foreach ($failedFile in $failed) {
            Write-Host "[FAIL] $failedFile" -ForegroundColor Red
        }
        throw ("Deployment completed with {0} failed file(s); manifest not updated." -f $failed.Count)
    }

    Write-Host "Writing deploy manifest for sync..." -ForegroundColor Cyan
    $manifestFiles = @{}
    foreach ($file in $files) {
        $relativePath = $file.FullName.Substring($distResolved.Length).TrimStart([char]'\', [char]'/').Replace('\', '/')
        $manifestFiles[$relativePath] = @{
            sha256 = Get-FileSha256Hex $file.FullName
            size   = $file.Length
        }
    }
    Write-DeployManifest $ManifestPath $manifestFiles $RemotePath $BasePath

    Write-Host ""
    Write-Host ("COMPLETE CLEAN DEPLOYMENT finished! Uploaded {0}/{1} files." -f $uploaded, $totalFiles) -ForegroundColor Green
    Write-Host ("Manifest saved: {0}" -f $ManifestPath) -ForegroundColor Cyan
    Write-Host "App should now work at: $PublicUrl" -ForegroundColor Cyan
} catch {
    Write-Host ("Deployment failed: {0}" -f $_.Exception.Message) -ForegroundColor Red
    exit 1
}
