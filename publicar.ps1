# Automações TASY — publica alterações no GitHub com 1 clique para atualizar todos os computadores.
# Uso: dê dois cliques em publicar.cmd (ou rode .\publicar.ps1).
param(
    [string]$Token = "",
    [string]$NomeRepo = "automacoes-tasy",
    [switch]$ManterVersao
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$PastaRaiz   = $PSScriptRoot
$BaseCfg     = Join-Path $env:USERPROFILE "AlertaExamesHSI"
$TokArq      = Join-Path $BaseCfg "github-publicar.token"
$TokArqLocal = Join-Path $PastaRaiz "github-publicar.token"
try { New-Item -ItemType Directory -Force $BaseCfg -ErrorAction Stop | Out-Null } catch {}

function Ler-TokenSalvo {
    if ($Token) { return $Token.Trim() }
    if ($env:GITHUB_TOKEN) { return $env:GITHUB_TOKEN.Trim() }
    foreach ($arq in @($TokArq, $TokArqLocal)) {
        try {
            if (Test-Path $arq -ErrorAction Stop) {
                $s = (Get-Content $arq -Raw -ErrorAction Stop).Trim() | ConvertTo-SecureString
                return [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)).Trim()
            }
        } catch {}
    }
    return ""
}

function Salvar-Token($t) {
    $enc = ConvertTo-SecureString $t -AsPlainText -Force | ConvertFrom-SecureString
    try { Set-Content -Path $TokArq -Value $enc -ErrorAction Stop } catch {}
    try { Set-Content -Path $TokArqLocal -Value $enc -ErrorAction Stop } catch {}
}

function GH-Api($Metodo, $Url, $Corpo = $null) {
    $h = @{
        Authorization          = "Bearer $script:TokenGH"
        "User-Agent"           = "AutomacoesTASY-Publisher"
        Accept                 = "application/vnd.github+json"
        "X-GitHub-Api-Version" = "2022-11-28"
    }
    $params = @{ Method = $Metodo; Headers = $h; Uri = $Url; UseBasicParsing = $true }
    if ($null -ne $Corpo) {
        $json = $Corpo | ConvertTo-Json -Depth 10 -Compress
        $params.Body = [Text.Encoding]::UTF8.GetBytes($json)
        $params.ContentType = "application/json; charset=utf-8"
    }
    return Invoke-RestMethod @params
}

if ($Token) { Salvar-Token $Token.Trim() }
$script:TokenGH = Ler-TokenSalvo
$digitado = $false
for ($tent = 1; $tent -le 3; $tent++) {
    if (-not $script:TokenGH) {
        Write-Host ""
        Write-Host "=== Configuração Inicial de Publicação no GitHub ===" -ForegroundColor Cyan
        Write-Host "Para enviar atualizações do seu computador para o GitHub, cole um Token do GitHub." -ForegroundColor Yellow
        Write-Host "(Os outros computadores NÃO precisarão de token, pois o repositório será público!)"
        Write-Host ""
        Write-Host "Como criar o token (leva 1 minuto):"
        Write-Host "  1. Acesse: https://github.com/settings/tokens/new"
        Write-Host "  2. Em 'Note', escreva: Automacoes TASY"
        Write-Host "  3. Em 'Expiration', escolha 'No expiration' (ou 1 ano)"
        Write-Host "  4. Marque a caixinha [x] repo (Full control of private/public repositories)"
        Write-Host "  5. Clique em 'Generate token' lá embaixo e cole o código (ghp_...) abaixo:"
        Write-Host ""
        $s = Read-Host "Cole o token aqui" -AsSecureString
        $script:TokenGH = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)).Trim()
        if (-not $script:TokenGH) { continue }
        $digitado = $true
    }
    try {
        $user = GH-Api "GET" "https://api.github.com/user"
        break
    } catch {
        $status = try { [int]$_.Exception.Response.StatusCode } catch { 0 }
        if ($status -eq 401) {
            Write-Host "⚠ O GitHub recusou o token ($($_.Exception.Message)). Tente novamente." -ForegroundColor Red
            $script:TokenGH = ""
            try { if (Test-Path $TokArq) { Remove-Item $TokArq -Force } } catch {}
            try { if (Test-Path $TokArqLocal) { Remove-Item $TokArqLocal -Force } } catch {}
            if ($tent -eq 3 -or $Token) { exit 1 }
        } else {
            Write-Host "⚠ Erro de conexão com o GitHub ($($_.Exception.Message))." -ForegroundColor Red
            exit 1
        }
    }
}
Salvar-Token $script:TokenGH

$Usuario = $user.login
$RepoCompleto = "$Usuario/$NomeRepo"
Write-Host "✓ Conectado ao GitHub como: $Usuario" -ForegroundColor Green

# 1. Garante que o repositório público existe no GitHub
try {
    $repoInfo = GH-Api "GET" "https://api.github.com/repos/$RepoCompleto"
    if ($repoInfo.private) {
        Write-Host "Convertendo o repositório $RepoCompleto para público (para não exigir token nos PCs)..." -ForegroundColor Yellow
        $repoInfo = GH-Api "PATCH" "https://api.github.com/repos/$RepoCompleto" @{ private = $false }
    }
} catch {
    Write-Host "Criando repositório público $RepoCompleto no GitHub..." -ForegroundColor Cyan
    $repoInfo = GH-Api "POST" "https://api.github.com/user/repos" @{
        name        = $NomeRepo
        description = "Extensão Chrome Automações TASY - Atualização Automática"
        private     = $false
        auto_init   = $true
    }
    Start-Sleep -Seconds 2
}

$Branch = if ($repoInfo.default_branch) { $repoInfo.default_branch } else { "main" }

# 2. Atualiza atualizar.ps1 com o repositório e branch corretos
$arqAtualizar = Join-Path $PastaRaiz "atualizar.ps1"
if (Test-Path $arqAtualizar) {
    $conteudoAt = Get-Content $arqAtualizar -Raw -Encoding UTF8
    $novoAt = $conteudoAt -replace '\$Repo\s*=\s*"[^"]*"', "`$Repo   = `"$RepoCompleto`""
    $novoAt = $novoAt -replace '\$Branch\s*=\s*"[^"]*"', "`$Branch = `"$Branch`""
    if ($novoAt -ne $conteudoAt) {
        [IO.File]::WriteAllText($arqAtualizar, $novoAt, (New-Object Text.UTF8Encoding($true)))
        Write-Host "✓ atualizar.ps1 configurado para $RepoCompleto ($Branch)" -ForegroundColor Green
    }
}

# 3. Incrementa automaticamente a versão no manifest.json (para acionar a atualização em todos os PCs)
$arqManifest = Join-Path $PastaRaiz "manifest.json"
$textoManifest = Get-Content $arqManifest -Raw -Encoding UTF8
$objManifest = $textoManifest | ConvertFrom-Json
$versaoAntiga = $objManifest.version

if (-not $ManterVersao) {
    $partes = $versaoAntiga.Split(".")
    while ($partes.Count -lt 3) { $partes += "0" }
    $partes[$partes.Count - 1] = [string]([int]$partes[$partes.Count - 1] + 1)
    $novaVersao = $partes -join "."
    $textoManifest = $textoManifest -replace ('"version"\s*:\s*"' + [regex]::Escape($versaoAntiga) + '"'), "`"version`": `"$novaVersao`""
    [IO.File]::WriteAllText($arqManifest, $textoManifest, (New-Object Text.UTF8Encoding($false)))
    Write-Host "✓ Versão atualizada no manifest.json: $versaoAntiga -> $novaVersao" -ForegroundColor Green
} else {
    $novaVersao = $versaoAntiga
    Write-Host "Mantendo versão do manifest.json: $novaVersao" -ForegroundColor Yellow
}

# 4. Coleta todos os arquivos da extensão (ignorando pastas auxiliares como 'rea' ou '.git')
$arquivos = Get-ChildItem -Path $PastaRaiz -Recurse -File | Where-Object {
    $rel = $_.FullName.Substring($PastaRaiz.Length).TrimStart('\', '/').Replace('\', '/')
    $rel -notmatch '^(rea|\.git|\.vscode|node_modules)/' -and
    $rel -notmatch '\.(token|log|tmp)$'
}

# Verifica se o repositório tem ao menos 1 commit; se estiver vazio, cria o primeiro commit com manifest.json
try {
    $refInfo = GH-Api "GET" "https://api.github.com/repos/$RepoCompleto/git/ref/heads/$Branch"
} catch {
    Write-Host "Inicializando branch $Branch no repositório..." -ForegroundColor Cyan
    $b64Manifest = [Convert]::ToBase64String([IO.File]::ReadAllBytes($arqManifest))
    GH-Api "PUT" "https://api.github.com/repos/$RepoCompleto/contents/manifest.json" @{
        message = "Inicializa extensão v$novaVersao"
        content = $b64Manifest
        branch  = $Branch
    } | Out-Null
    $refInfo = GH-Api "GET" "https://api.github.com/repos/$RepoCompleto/git/ref/heads/$Branch"
}

$ultimoCommitSha = $refInfo.object.sha

# Busca a árvore atual do GitHub para enviar apenas os arquivos que mudaram (muito mais rápido)
$shasRemotos = @{}
try {
    $arvoreAtual = GH-Api "GET" "https://api.github.com/repos/$RepoCompleto/git/trees/${ultimoCommitSha}?recursive=1"
    foreach ($item in $arvoreAtual.tree) {
        if ($item.type -eq "blob") { $shasRemotos[$item.path] = $item.sha }
    }
} catch {}

$sha1 = [Security.Cryptography.SHA1]::Create()
$itensArvore = @()
$enviados = 0
foreach ($arq in $arquivos) {
    $caminhoRel = $arq.FullName.Substring($PastaRaiz.Length).TrimStart('\', '/').Replace('\', '/')
    $bytes = [IO.File]::ReadAllBytes($arq.FullName)
    $cabBlob = [Text.Encoding]::ASCII.GetBytes("blob $($bytes.Length)`0")
    $buf = New-Object byte[] ($cabBlob.Length + $bytes.Length)
    [Array]::Copy($cabBlob, 0, $buf, 0, $cabBlob.Length)
    [Array]::Copy($bytes, 0, $buf, $cabBlob.Length, $bytes.Length)
    $shaLocal = ([BitConverter]::ToString($sha1.ComputeHash($buf))).Replace("-", "").ToLowerInvariant()

    if ($shasRemotos[$caminhoRel] -eq $shaLocal) {
        $shaFinal = $shaLocal
    } else {
        $b64 = [Convert]::ToBase64String($bytes)
        $blob = GH-Api "POST" "https://api.github.com/repos/$RepoCompleto/git/blobs" @{
            content  = $b64
            encoding = "base64"
        }
        $shaFinal = $blob.sha
        $enviados++
    }
    $itensArvore += @{
        path = $caminhoRel
        mode = "100644"
        type = "blob"
        sha  = $shaFinal
    }
}
Write-Host "✓ $enviados arquivo(s) modificado(s) enviado(s) (de $($arquivos.Count) no total) para https://github.com/$RepoCompleto" -ForegroundColor Cyan

$novaArvore = GH-Api "POST" "https://api.github.com/repos/$RepoCompleto/git/trees" @{
    tree = $itensArvore
}

$novoCommit = GH-Api "POST" "https://api.github.com/repos/$RepoCompleto/git/commits" @{
    message = "Atualização automática v$novaVersao"
    tree    = $novaArvore.sha
    parents = @($ultimoCommitSha)
}

GH-Api "PATCH" "https://api.github.com/repos/$RepoCompleto/git/refs/heads/$Branch" @{
    sha   = $novoCommit.sha
    force = $true
} | Out-Null

# Se este computador também tiver a extensão instalada em AlertaExamesHSI\extensao, já atualiza na hora
$DestLocal = Join-Path $BaseCfg "extensao"
try {
    if (Test-Path $DestLocal -ErrorAction Stop) {
        & robocopy $PastaRaiz $DestLocal /MIR /XF "*.token" "*.log" "*.tmp" /XD ".git" ".vscode" "node_modules" "rea" /NJH /NJS /NFL /NDL /NP /R:1 /W:1 | Out-Null
    }
} catch {}

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Green
Write-Host "✓ PUBLICADO COM SUCESSO! Versão $novaVersao está online!" -ForegroundColor Green
Write-Host "  Repositório: https://github.com/$RepoCompleto" -ForegroundColor Cyan
Write-Host "  Todos os computadores instalados receberão esta atualização"
Write-Host "  automaticamente em até 5 minutos (sem precisar apertar nada)."
Write-Host "==================================================================" -ForegroundColor Green
