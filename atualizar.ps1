# Automações TASY — instala e mantém a extensão atualizada a partir do GitHub (repositório público).
# 1ª vez (instalar.cmd): baixa a extensão para C:\Users\<você>\AlertaExamesHSI\extensao
#   e cria uma tarefa do Windows que repete isto ao ligar o PC e a cada 5 min, escondida.
# Depois: a tarefa baixa a versão nova quando houver; a extensão percebe e se recarrega sozinha.
param([switch]$Silencioso)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Repo   = "luccaoo97/automacoes-tasy"
$Branch = "main"
$Pasta  = ""
# fora do AppData: apps empacotados gravam o AppData numa cópia que só eles enxergam
$Base   = Join-Path $env:USERPROFILE "AlertaExamesHSI"
$Dest   = Join-Path $Base "extensao"
$LogArq = Join-Path $Base "atualizar.log"
$Tarefa = "Alerta de Exames HSI - atualizar"
New-Item -ItemType Directory -Force $Base | Out-Null

function Log($m) {
    $l = "{0}  {1}" -f (Get-Date -Format "dd/MM HH:mm:ss"), $m
    Add-Content -Path $LogArq -Value $l -Encoding UTF8
    if (-not $Silencioso) { Write-Host $m }
}

if ($Repo -match '^SEU_USUARIO/') {
    Log "⚠ Repositório ainda não configurado. Rode publicar.cmd primeiro na máquina principal para criar e configurar o repositório."
    exit 1
}

$Headers = @{
    "User-Agent"    = "AlertaExamesHSI"
    "Cache-Control" = "no-cache, no-store, must-revalidate"
    "Pragma"        = "no-cache"
}

# ---------- versão ----------
function Versao-Local {
    $m = Join-Path $Dest "manifest.json"
    if (Test-Path $m) { try { return (Get-Content $m -Raw -Encoding UTF8 | ConvertFrom-Json).version } catch {} }
    return ""
}

$local = Versao-Local
$caminhoManifest = if ($Pasta) { "$Pasta/manifest.json" } else { "manifest.json" }
$ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$urlManifest = "https://raw.githubusercontent.com/$Repo/$Branch/$caminhoManifest?t=$ts"

try {
    $resp = Invoke-WebRequest -UseBasicParsing -Headers $Headers -Uri $urlManifest
    $textoManifest = [Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray())
    $remota = ($textoManifest | ConvertFrom-Json).version
} catch {
    Log "não consegui ler a versão no GitHub ($($_.Exception.Message))"
    exit 1
}

if ($local -and $local -eq $remota) {
    Log "já está na versão mais recente ($local)"
} else {
    Log ("baixando a versão {0}{1}..." -f $remota, $(if ($local) { " (instalada: $local)" } else { "" }))
    $tmp = Join-Path $env:TEMP ("alertahsi_" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force $tmp | Out-Null
    try {
        $zip = Join-Path $tmp "repo.zip"
        $urlZip = "https://codeload.github.com/$Repo/zip/refs/heads/$Branch?t=$ts"
        Invoke-WebRequest -UseBasicParsing -Headers $Headers -Uri $urlZip -OutFile $zip | Out-Null
        Expand-Archive -Path $zip -DestinationPath $tmp -Force
        $orig = Get-ChildItem $tmp -Directory | ForEach-Object {
            if ($Pasta) { Join-Path $_.FullName $Pasta } else { $_.FullName }
        } | Where-Object { Test-Path (Join-Path $_ "manifest.json") } | Select-Object -First 1
        if (-not $orig) { throw "o arquivo manifest.json não veio no download" }
        New-Item -ItemType Directory -Force $Dest | Out-Null
        & robocopy $orig $Dest /MIR /NJH /NJS /NFL /NDL /NP /R:2 /W:2 | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "falha ao copiar os arquivos (robocopy $LASTEXITCODE)" }
        Log "✓ extensão atualizada para a versão $remota — o Chrome recarrega sozinho em até 1 minuto"
    } catch {
        Log "⚠ erro ao atualizar: $($_.Exception.Message)"
        exit 1
    } finally {
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# ---------- tarefa agendada (ao entrar no Windows e a cada 5 min, sem abrir janela) ----------
$vbs = Join-Path $Base "atualizar-oculto.vbs"
$cmdPs = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""$Dest\atualizar.ps1"" -Silencioso"
Set-Content -Path $vbs -Encoding ASCII -Value ('CreateObject("WScript.Shell").Run "' + $cmdPs.Replace('"', '""') + '", 0, False')
$acao = New-ScheduledTaskAction -Execute "wscript.exe" -Argument """$vbs"""
$t1 = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$t2 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$cfg = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName $Tarefa -Action $acao -Trigger $t1, $t2 -Settings $cfg -Description "Mantém a extensão Automações TASY atualizada a partir do GitHub (a cada 5 min)" -Force | Out-Null
Log "tarefa de atualização automática garantida (ao entrar no Windows e a cada 5 min)"

if (-not $Silencioso) {
    Set-Clipboard -Value $Dest
    Write-Host ""
    Write-Host "Pronto! A extensão está em:" -ForegroundColor Green
    Write-Host "  $Dest"
    Write-Host "(o caminho já foi copiado — é só colar)"
    Write-Host ""
    Write-Host "Só na primeira vez neste computador:"
    Write-Host "  1. No Chrome, abra chrome://extensions e ligue o Modo do desenvolvedor"
    Write-Host "  2. Clique em 'Carregar sem compactação', cole o caminho acima e confirme"
    Write-Host "  3. Abra o portal Vue Motion e faça a busca de hoje + CT uma vez"
    Write-Host ""
    Write-Host "Depois disso as atualizações chegam sozinhas em até 5 minutos."
}
