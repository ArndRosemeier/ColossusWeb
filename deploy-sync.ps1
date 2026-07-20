# Colossus Web — incremental FTP sync (domainfactory / futuremagic.de)
#
# Builds web/, compares dist/ to a local SHA-256 manifest, uploads only
# changed files, deletes remote files no longer in the build, then saves
# the new manifest. Does not store the FTP password on disk.
#
# Usage (from repo root):
#   .\deploy-sync.ps1
#   .\deploy-sync.ps1 -Clean
#   .\deploy-sync.ps1 -RemotePath "/webseiten/ColossusWeb/" -BasePath "/ColossusWeb/"
#
# Password: $env:FTP_PASSWORD, or User env FTP_PASSWORD, or interactive prompt.
# Full wipe without manifest logic: use .\deploy-clean.ps1

param(
    [string]$FtpServer = "ftp.futuremagic.de",
    [string]$FtpUser = "12529-Pyrion",
    [string]$RemotePath = "/webseiten/ColossusWeb/",
    [string]$BasePath = "/ColossusWeb/",
    [string]$PublicUrl = "https://futuremagic.de/ColossusWeb/",
    [switch]$Clean
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

Write-Host "Starting Colossus incremental deploy sync..." -ForegroundColor Cyan
if ($Clean) {
    Write-Host "Clean mode: wipe remote $RemotePath then upload everything." -ForegroundColor Yellow
} else {
    Write-Host "Sync mode: upload changes + delete orphans (manifest-based)." -ForegroundColor Yellow
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
        if (-not (Test-FtpDirectory $dir $Password)) {
            throw ("Could not create FTP directory {0} : {1}" -f $dir, $_.Exception.Message)
        }
    }
    [void]$Created.Add($dir)
}

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
        Write-Host ("Could not list directory {0} (may be empty/new): {1}" -f $dir, $_.Exception.Message) -ForegroundColor Gray
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

function Get-RelativeDistPath([string]$FullPath, [string]$DistResolved) {
    return $FullPath.Substring($DistResolved.Length).TrimStart([char]'\', [char]'/').Replace('\', '/')
}

function Read-DeployManifest([string]$Path) {
    if (-not (Test-Path $Path)) { return $null }
    try {
        return Get-Content -Raw -Path $Path | ConvertFrom-Json
    } catch {
        Write-Host ("Could not read manifest ({0}); treating as full upload." -f $_.Exception.Message) -ForegroundColor Yellow
        return $null
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

    Write-Host ("Building Colossus (base={0})..." -f $BasePath) -ForegroundColor Yellow
    Push-Location $WebDir
    try {
        $env:COLOSSUS_BASE = $BasePath
        npm run build
        if ($LASTEXITCODE -ne 0) {
            throw ("npm run build failed with exit code {0}" -f $LASTEXITCODE)
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
    $criticalFiles += "variants/Default/variant.json"

    foreach ($rel in $criticalFiles) {
        $local = Join-Path $DistDir ($rel.Replace('/', [IO.Path]::DirectorySeparatorChar))
        if (-not (Test-Path $local)) {
            throw ("Critical file missing after build: {0}" -f $rel)
        }
    }

    $distResolved = (Resolve-Path $DistDir).Path
    $localFiles = @(Get-ChildItem -Path $DistDir -Recurse -File -Force)
    Write-Host ("Hashing {0} local dist files..." -f $localFiles.Count) -ForegroundColor Cyan

    $newMap = @{}
    foreach ($file in $localFiles) {
        $rel = Get-RelativeDistPath $file.FullName $distResolved
        $newMap[$rel] = @{
            sha256 = Get-FileSha256Hex $file.FullName
            size   = $file.Length
            full   = $file.FullName
        }
    }

    $oldManifest = Read-DeployManifest $ManifestPath
    $oldMap = @{}
    $manifestUsable = $false
    if ($oldManifest -and -not $Clean) {
        if ($oldManifest.remotePath -eq $RemotePath -and $oldManifest.basePath -eq $BasePath) {
            $manifestUsable = $true
            if ($oldManifest.files) {
                foreach ($prop in $oldManifest.files.PSObject.Properties) {
                    $oldMap[$prop.Name] = @{
                        sha256 = [string]$prop.Value.sha256
                        size   = [int64]$prop.Value.size
                    }
                }
            }
        } else {
            Write-Host "Manifest target mismatch; uploading all files (no remote wipe)." -ForegroundColor Yellow
        }
    } elseif (-not $oldManifest) {
        Write-Host "No manifest yet; uploading all files." -ForegroundColor Yellow
    }

    $toUpload = New-Object System.Collections.Generic.List[string]
    $toDelete = New-Object System.Collections.Generic.List[string]
    $skipped = 0

    if ($Clean -or -not $manifestUsable) {
        foreach ($rel in $newMap.Keys) {
            $toUpload.Add($rel)
        }
    } else {
        foreach ($rel in $newMap.Keys) {
            if (-not $oldMap.ContainsKey($rel)) {
                $toUpload.Add($rel)
                continue
            }
            $old = $oldMap[$rel]
            $neu = $newMap[$rel]
            if ($old.sha256 -ne $neu.sha256 -or [int64]$old.size -ne [int64]$neu.size) {
                $toUpload.Add($rel)
            } else {
                $skipped++
            }
        }
        foreach ($rel in $oldMap.Keys) {
            if (-not $newMap.ContainsKey($rel)) {
                $toDelete.Add($rel)
            }
        }
    }

    Write-Host ("Plan: upload {0}, skip {1}, delete {2}" -f $toUpload.Count, $skipped, $toDelete.Count) -ForegroundColor Cyan

    $FTP_PASSWORD = Get-FtpPassword
    $createdDirs = New-Object 'System.Collections.Generic.HashSet[string]'

    Write-Host ("Ensuring remote path exists: {0}" -f $RemotePath) -ForegroundColor Cyan
    Ensure-FtpPathTree $RemotePath $FTP_PASSWORD $createdDirs

    if ($Clean) {
        Write-Host "COMPLETELY CLEANING remote directory..." -ForegroundColor Red
        Remove-FtpDirectoryContents -RemoteDir $RemotePath -Password $FTP_PASSWORD
        Ensure-FtpPathTree $RemotePath $FTP_PASSWORD $createdDirs
        $toDelete.Clear()
    }

    $dirSet = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($rel in $toUpload) {
        $slash = $rel.LastIndexOf('/')
        if ($slash -gt 0) {
            [void]$dirSet.Add($rel.Substring(0, $slash))
        }
    }
    foreach ($relDir in ($dirSet | Sort-Object { $_.Length }, { $_ })) {
        Ensure-FtpPathTree "$RemotePath$relDir/" $FTP_PASSWORD $createdDirs
    }

    $uploaded = 0
    $deleted = 0
    $failed = @()

    Write-Host "Uploading..." -ForegroundColor Green
    foreach ($rel in ($toUpload | Sort-Object)) {
        $entry = $newMap[$rel]
        $remoteFile = "$RemotePath$rel"
        try {
            $ftpRequest = New-FtpRequest "ftp://$FtpServer$remoteFile" ([System.Net.WebRequestMethods+Ftp]::UploadFile) $FTP_PASSWORD
            $fileContent = [System.IO.File]::ReadAllBytes($entry.full)
            $ftpRequest.ContentLength = $fileContent.Length
            $requestStream = $ftpRequest.GetRequestStream()
            $requestStream.Write($fileContent, 0, $fileContent.Length)
            $requestStream.Close()
            $response = $ftpRequest.GetResponse()
            $response.Close()

            $uploaded++
            $sizeKB = [math]::Round($fileContent.Length / 1KB, 1)
            Write-Host ("Uploaded: {0} ({1} KB)" -f $rel, $sizeKB) -ForegroundColor Green
        } catch {
            $failed += $rel
            Write-Host ("Failed upload: {0} - {1}" -f $rel, $_.Exception.Message) -ForegroundColor Red
        }
    }

    if ($toDelete.Count -gt 0) {
        Write-Host "Deleting remote orphans..." -ForegroundColor Yellow
        foreach ($rel in ($toDelete | Sort-Object)) {
            $remoteFile = "$RemotePath$rel"
            try {
                $del = New-FtpRequest "ftp://$FtpServer$remoteFile" ([System.Net.WebRequestMethods+Ftp]::DeleteFile) $FTP_PASSWORD
                $delResp = $del.GetResponse()
                $delResp.Close()
                $deleted++
                Write-Host ("Deleted: {0}" -f $rel) -ForegroundColor DarkYellow
            } catch {
                Write-Host ("Could not delete {0} (may already be gone): {1}" -f $rel, $_.Exception.Message) -ForegroundColor Gray
            }
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
        Write-Host "=== FAILED ===" -ForegroundColor Red
        foreach ($failedFile in $failed) {
            Write-Host ("[FAIL] {0}" -f $failedFile) -ForegroundColor Red
        }
        throw ("Deployment completed with {0} failed file(s); manifest not updated." -f $failed.Count)
    }

    $manifestFiles = @{}
    foreach ($rel in $newMap.Keys) {
        $manifestFiles[$rel] = @{
            sha256 = $newMap[$rel].sha256
            size   = $newMap[$rel].size
        }
    }
    Write-DeployManifest $ManifestPath $manifestFiles $RemotePath $BasePath

    Write-Host ""
    Write-Host ("SYNC finished. Uploaded {0}, skipped {1}, deleted {2}." -f $uploaded, $skipped, $deleted) -ForegroundColor Green
    Write-Host ("Manifest saved: {0}" -f $ManifestPath) -ForegroundColor Cyan
    Write-Host ("App should now work at: {0}" -f $PublicUrl) -ForegroundColor Cyan
} catch {
    Write-Host ("Deployment failed: {0}" -f $_.Exception.Message) -ForegroundColor Red
    exit 1
}
