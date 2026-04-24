param([string]$Path)
if (!(Test-Path $Path)) { Write-Error "Path not found: $Path"; return }
$texconv = "C:\Users\Asus1\AppData\Roaming\RimWorldModManager\texconv\texconv.exe"
if (!(Test-Path $texconv)) {
    $texconv = "C:\Users\Asus1\.gemini\antigravity\texconv\texconv.exe"
}
if (!(Test-Path $texconv)) {
    Write-Error "texconv.exe not found. Please provide path to texconv.exe"
    return
}

Get-ChildItem -Path $Path -Filter *.png -Recurse | ForEach-Object {
    Write-Host "Flipping: $(_.FullName)"
    & $texconv -ft png -y -vflip -o $(_.DirectoryName) $(_.FullName) | Out-Null
}
