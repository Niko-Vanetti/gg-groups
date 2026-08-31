# Aplica una lista de cambios de extensiones cuando VS Code ya se ha cerrado, y lo reabre.
#
# Hace falta este rodeo porque VS Code mantiene su base de estado en memoria y la vuelca
# al salir: lo que se escriba con el editor abierto se perderia. Recargar la ventana
# tampoco basta — eso reinicia la ventana y el host de extensiones, pero no el proceso
# principal, que es justamente el que tiene esa base. Asi que GG Groups lanza esta
# ventana, pide a VS Code que se cierre, y el trabajo ocurre en el hueco de despues.
#
# Se lanza sola desde el tablero; no hace falta ejecutarla a mano.

param(
  [Parameter(Mandatory = $true)][string]$Python,
  [Parameter(Mandatory = $true)][string]$Script,
  [string]$Disable = '',
  [string]$Enable = '',
  [Parameter(Mandatory = $true)][string]$CodeExe,
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = 'Continue'
$apagar = @($Disable -split ',' | Where-Object { $_ })
$encender = @($Enable -split ',' | Where-Object { $_ })

if ($apagar.Count -eq 0 -and $encender.Count -eq 0) {
  Write-Host 'No hay nada en la lista.' -ForegroundColor Yellow
  Start-Sleep -Seconds 3
  exit 0
}

Write-Host 'GG Groups' -ForegroundColor Cyan
foreach ($id in $apagar) { Write-Host "  - $id" }
foreach ($id in $encender) { Write-Host "  + $id" }
Write-Host ''
Write-Host 'Esperando a que VS Code termine de cerrarse...'

$limite = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Process -Name 'Code' -ErrorAction SilentlyContinue) -and ((Get-Date) -lt $limite)) {
  Start-Sleep -Milliseconds 400
}

if (Get-Process -Name 'Code' -ErrorAction SilentlyContinue) {
  # Puede pasar si quedaba algo sin guardar y se cancelo el cierre. No se toca nada:
  # escribir ahora seria inutil, porque VS Code sobreescribiria al salir.
  Write-Host ''
  Write-Host 'VS Code sigue abierto, asi que no se ha cambiado nada.' -ForegroundColor Yellow
  Write-Host 'Cierralo del todo y vuelve a marcar la lista.'
  Start-Sleep -Seconds 6
  exit 1
}

# Un respiro: al salir, VS Code todavia esta soltando el archivo.
Start-Sleep -Milliseconds 800
$codigo = 0
if ($apagar.Count) {
  & $Python $Script disable @apagar
  if ($LASTEXITCODE -ne 0) { $codigo = $LASTEXITCODE }
}
if ($encender.Count) {
  & $Python $Script enable @encender
  if ($LASTEXITCODE -ne 0) { $codigo = $LASTEXITCODE }
}

Write-Host ''
if ($codigo -eq 0) {
  Write-Host 'Hecho. Abriendo VS Code otra vez...' -ForegroundColor Green
} else {
  Write-Host 'Algo no se pudo aplicar. Se abre VS Code igualmente.' -ForegroundColor Yellow
}
Start-Sleep -Seconds 2
Start-Process -FilePath $CodeExe
Start-Sleep -Seconds 1
