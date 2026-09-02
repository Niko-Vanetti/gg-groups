# Aplica una lista de cambios de extensiones cuando VS Code ya se ha cerrado, y lo reabre.
#
# Hace falta este rodeo porque VS Code mantiene su base de estado en memoria y la vuelca
# al salir: lo que se escriba con el editor abierto se perderia. Recargar la ventana
# tampoco basta — eso reinicia la ventana y el host de extensiones, pero no el proceso
# principal, que es justamente el que tiene esa base. Asi que GG Groups lanza esta
# ventana, pide a VS Code que se cierre, y el trabajo ocurre en el hueco de despues.
#
# Ese hueco es el punto delicado: si el usuario vuelve a abrir VS Code antes de tiempo,
# escribir seria inutil. Por eso la ventana es visible, avisa de que no lo abra, y si
# reaparece vuelve a esperar en vez de rendirse en silencio.
#
# Se lanza sola desde el tablero; no hace falta ejecutarla a mano.

param(
  [Parameter(Mandatory = $true)][string]$Python,
  [Parameter(Mandatory = $true)][string]$Script,
  [string]$Disable = '',
  [string]$Enable = '',
  [Parameter(Mandatory = $true)][string]$CodeExe,
  [string]$Log = '',
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = 'Continue'

# Si esta ventana hereda el entorno del host de extensiones, Code.exe arranca como Node y
# no abre el editor: ELECTRON_RUN_AS_NODE lo convierte en un interprete. Las VSCODE_*
# apuntan ademas a la instancia que se acaba de cerrar. Se limpian antes de nada, para que
# valga igual si alguien ejecuta este guion desde una terminal de VS Code.
Get-ChildItem Env: | Where-Object { $_.Name -like 'ELECTRON_*' -or $_.Name -like 'VSCODE_*' } |
  ForEach-Object { Remove-Item ('Env:' + $_.Name) -ErrorAction SilentlyContinue }

$apagar = @($Disable -split ',' | Where-Object { $_ })
$encender = @($Enable -split ',' | Where-Object { $_ })

# Todo queda escrito ademas en un archivo: sin esto, un fallo aqui es invisible desde
# VS Code y no hay forma de saber por que no paso nada.
function Anota($texto) {
  if ($Log) { try { Add-Content -Path $Log -Value "$(Get-Date -Format 'HH:mm:ss')  $texto" -Encoding utf8 } catch {} }
}
$abierto = { [bool](Get-Process -Name 'Code' -ErrorAction SilentlyContinue) }

if ($apagar.Count -eq 0 -and $encender.Count -eq 0) {
  Anota 'lista vacia'
  Write-Host 'No hay nada en la lista.' -ForegroundColor Yellow
  Start-Sleep -Seconds 3
  exit 0
}

Write-Host ''
Write-Host '  GG Groups' -ForegroundColor Cyan
Write-Host '  ---------'
foreach ($id in $apagar) { Write-Host "   - $id" }
foreach ($id in $encender) { Write-Host "   + $id" }
Write-Host ''
Write-Host '  NO abras VS Code: esta ventana lo abre sola al terminar.' -ForegroundColor Yellow
Write-Host ''
Anota "inicio | apagar: $($apagar -join ' ') | encender: $($encender -join ' ')"

# Se espera a que VS Code cierre. Si vuelve a aparecer antes de escribir, se espera otra
# vez: rendirse ahi era lo que hacia que no pasara nada sin decir por que.
$limite = (Get-Date).AddSeconds($TimeoutSeconds)
$escrito = $false
$avisado = $false
while ((Get-Date) -lt $limite) {
  if (& $abierto) {
    if (-not $avisado) {
      Write-Host '  Esperando a que VS Code termine de cerrarse...'
      $avisado = $true
    }
    Start-Sleep -Milliseconds 400
    continue
  }
  # Cerrado. Se escribe cuanto antes, para que no de tiempo a reabrirlo por en medio.
  Start-Sleep -Milliseconds 400
  if (& $abierto) { $avisado = $false; continue }

  Anota 'VS Code cerrado, escribiendo'
  Write-Host '  Aplicando...' -ForegroundColor Green
  $codigo = 0
  # --force porque la comprobacion ya se ha hecho aqui, justo ahora: la del guion de
  # Python es para quien lo ejecuta a mano, y aqui solo volveria a mirar lo mismo.
  if ($apagar.Count) {
    & $Python $Script disable --force @apagar
    if ($LASTEXITCODE -ne 0) { $codigo = $LASTEXITCODE }
  }
  if ($encender.Count) {
    & $Python $Script enable --force @encender
    if ($LASTEXITCODE -ne 0) { $codigo = $LASTEXITCODE }
  }
  $escrito = $true
  Anota "escrito, codigo $codigo"
  break
}

Write-Host ''
if (-not $escrito) {
  Anota 'agotado el tiempo: VS Code nunca llego a cerrarse'
  Write-Host '  VS Code no llego a cerrarse, asi que no se ha cambiado nada.' -ForegroundColor Yellow
  Write-Host '  Puede que quedara algo sin guardar. Vuelve a intentarlo.'
  Write-Host ''
  Write-Host '  Pulsa una tecla para cerrar esta ventana.'
  [void]$Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
  exit 1
}

if ($codigo -eq 0) {
  Write-Host '  Hecho. Abriendo VS Code otra vez...' -ForegroundColor Green
  Start-Sleep -Seconds 2
  if (-not (& $abierto)) { Start-Process -FilePath $CodeExe }
  Start-Sleep -Seconds 2
} else {
  Anota "fallo del guion, codigo $codigo"
  Write-Host '  Algo no se pudo aplicar. Lo de arriba dice que.' -ForegroundColor Yellow
  Write-Host ''
  Write-Host '  Pulsa una tecla para abrir VS Code y cerrar esta ventana.'
  [void]$Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
  if (-not (& $abierto)) { Start-Process -FilePath $CodeExe }
}
