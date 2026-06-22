# Yildiz Avcilari - TWA AAB derleme + imzalama (yerel, Bubblewrap projesi)
# Kullanim:  pwsh ./build-aab.ps1
# Onkosul: JDK 17 + Android SDK (C:\dev\android-sdk: platforms;android-36, build-tools;36.0.0)
#          ve bu klasorde bubblewrap update ile uretilmis proje (gradlew, app/).
# Cikti: app-release-bundle.aab (imzali, Play'e yuklenebilir). Sifre keystore-credentials.txt'den okunur (gitignored).

$ErrorActionPreference = "Stop"
$dir = $PSScriptRoot
Set-Location $dir

$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot"
$env:ANDROID_HOME = "C:\dev\android-sdk"
$env:ANDROID_SDK_ROOT = "C:\dev\android-sdk"
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"

# sifreyi credentials dosyasindan al
$cred = Get-Content "$dir\keystore-credentials.txt"
$pw = ($cred | Select-String '^storepass:\s*(.+)$').Matches.Groups[1].Value.Trim()
if (-not $pw) { throw "storepass okunamadi (keystore-credentials.txt)" }

Write-Host "==> gradle bundleRelease (imzasiz AAB)..."
& .\gradlew.bat bundleRelease --stacktrace
if ($LASTEXITCODE -ne 0) { throw "gradle bundleRelease basarisiz ($LASTEXITCODE)" }

$unsigned = "app\build\outputs\bundle\release\app-release.aab"
$signed = "app-release-bundle.aab"
if (-not (Test-Path $unsigned)) { throw "imzasiz AAB bulunamadi: $unsigned" }

Write-Host "==> jarsigner ile imzala (SHA256withRSA)..."
& "$env:JAVA_HOME\bin\jarsigner.exe" -verbose -sigalg SHA256withRSA -digestalg SHA-256 `
  -keystore "$dir\android.keystore" "$unsigned" yildiz `
  -storepass $pw -keypass $pw -signedjar "$dir\$signed" | Select-Object -Last 3
if ($LASTEXITCODE -ne 0) { throw "jarsigner basarisiz ($LASTEXITCODE)" }

Write-Host "==> dogrula..."
& "$env:JAVA_HOME\bin\jarsigner.exe" -verify "$dir\$signed" | Select-Object -Last 1
$sz = [math]::Round((Get-Item "$dir\$signed").Length / 1KB)
Write-Host "TAMAM -> $signed ($sz KB)"
