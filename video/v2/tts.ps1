# TSUGU AI demo video v2 (copied from video/tts.ps1): temporary narration with Windows System.Speech (Microsoft Haruka).
# Reads video/v2/narration.txt (UTF-8). For each scene "[sNN m:ss.s limitX.X...]" it synthesizes the "yomi" line
# (the line after the narration line) into video/v2/out/tts/sNN.wav, and raises the speaking rate until the
# audio fits within the limit. Results (duration, rate) go to video/v2/out/tts/tts.json (read by edit.mjs).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File video/v2/tts.ps1
# This file is kept ASCII-only so that Windows PowerShell 5.1 reads it correctly; Japanese text lives in narration.txt.

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$outDir = Join-Path $here "out\tts"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$lines = Get-Content -Path (Join-Path $here "narration.txt") -Encoding UTF8
$yomiPrefix = ([string][char]0x8AAD) + ([string][char]0x307F) + ":"   # "yomi:" in Japanese

$items = @()
$cur = $null
foreach ($line in $lines) {
  if ($line -match '^\[(s\d\d) (\d+):(\d+(?:\.\d+)?) \D*(\d+(?:\.\d+)?)') {
    $cur = [ordered]@{ id = $Matches[1]; start = [double]$Matches[2] * 60 + [double]$Matches[3]; limit = [double]$Matches[4]; text = $null }
    $items += $cur
  } elseif ($cur -ne $null -and $line.StartsWith($yomiPrefix)) {
    $cur.text = $line.Substring($yomiPrefix.Length).Trim()
  }
}

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Name -like "*Haruka*" } | Select-Object -First 1
if ($voice -eq $null) { throw "Microsoft Haruka voice is not installed" }
$synth.SelectVoice($voice.VoiceInfo.Name)
$synth.Volume = 100
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)

function Get-WavSeconds($path) {
  $len = (Get-Item $path).Length
  return [math]::Round(($len - 44) / 48000.0, 2)   # 24 kHz, 16 bit, mono = 48000 bytes per second
}

$result = @()
foreach ($it in $items) {
  if ([string]::IsNullOrEmpty($it.text)) { continue }
  $wav = Join-Path $outDir ($it.id + ".wav")
  $rate = 0
  while ($true) {
    $synth.Rate = $rate
    $synth.SetOutputToWaveFile($wav, $fmt)
    $synth.Speak($it.text)
    $synth.SetOutputToNull()
    $sec = Get-WavSeconds $wav
    if ($sec -le $it.limit -or $rate -ge 6) { break }
    $rate += 1
  }
  $fits = $sec -le $it.limit
  Write-Output ("{0} start={1} limit={2} rate={3} seconds={4} fits={5}" -f $it.id, $it.start, $it.limit, $rate, $sec, $fits)
  $result += [ordered]@{ id = $it.id; start = $it.start; limit = $it.limit; rate = $rate; seconds = $sec; fits = $fits; file = ($it.id + ".wav") }
}
$synth.Dispose()
$json = ConvertTo-Json -InputObject $result -Depth 3
[System.IO.File]::WriteAllText((Join-Path $outDir "tts.json"), $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Output ("wrote " + (Join-Path $outDir "tts.json"))
