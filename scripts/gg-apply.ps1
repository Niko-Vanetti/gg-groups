# Aplica un cambio de extensiones cuando VS Code ya se ha cerrado, y lo vuelve a abrir.
#
# Hace falta este rodeo porque VS Code mantiene su base de estado en memoria y la vuelca
# al salir: lo que se escriba con el editor abierto se perderia. Asi que GG Groups lanza
# esta ventana, pide a VS Code que se cierre, y el trabajo ocurre en el hueco de despues.
#
# Se lanza sola desde el tablero; no hace falta ejecutarla a mano.

param(
  [Parameter(Mandatory = $true)][string]$Python,
  [Parameter(Mandatory = $true)][string]$Script,
  [Parameter(Mandatory = $true)][ValidateSet('disable', 'enable')][string]$Action,
  [Parameter(Mandatory = $true)][string]$Id,
  [Parameter(Mandatory = $true)][string]$CodeExe,
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = 'Continue'
$verbo = if ($Action -eq 'disable') { 'Desactivando' } else { 'Activando' }
Write-Host "GG Groups - $verbo $Id" -ForegroundColor Cyan
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
  Write-Host 'Cierralo del todo y vuelve a intentarlo.'
  Start-Sleep -Seconds 6
  exit 1
}

# Un respiro: al salir, VS Code todavia esta soltando el archivo.
Start-Sleep -Milliseconds 800
& $Python $Script $Action $Id
$codigo = $LASTEXITCODE

Write-Host ''
if ($codigo -eq 0) {
  Write-Host 'Hecho. Abriendo VS Code otra vez...' -ForegroundColor Green
} else {
  Write-Host 'No se pudo aplicar el cambio. Se abre VS Code igualmente.' -ForegroundColor Yellow
}
Start-Sleep -Seconds 2
Start-Process -FilePath $CodeExe
Start-Sleep -Seconds 1
