#!/usr/bin/env python3
"""
Activa y desactiva extensiones de VS Code sin abrir la interfaz.

Por que existe
--------------
VS Code no expone a las extensiones ninguna forma de desactivar a otra: no hay API, y
los unicos comandos que hay son "todas" y "todas en este espacio de trabajo". La CLI
tampoco sirve — su propia ayuda dice de `--disable-extension` que "no se persiste y solo
tiene efecto en la ventana que abre ese comando".

Lo que si hay es el sitio donde VS Code guarda esa lista: la clave
`extensionsIdentifiers/disabled` de su base de estado global (state.vscdb, SQLite).
Este guion la lee y la escribe, que es exactamente lo que hace el editor al pulsar
Deshabilitar.

Con VS Code CERRADO
-------------------
Es obligatorio, y el guion se niega a seguir si lo encuentra abierto. VS Code mantiene
esa base en memoria y la vuelca al salir: cualquier cambio hecho con el editor abierto
se perderia al cerrarlo, o dejaria el archivo a medias.

Uso
---
    python gg-extensions.py list                 lo instalado, y si esta activo
    python gg-extensions.py status               solo lo desactivado
    python gg-extensions.py disable <id> [...]   desactiva (acepta varios)
    python gg-extensions.py enable  <id> [...]   reactiva
    python gg-extensions.py enable --all         reactiva todo

El identificador es `editor.nombre`, tal como sale en `list`. Antes de cada escritura se
guarda una copia de seguridad con fecha junto al original.
"""

import argparse
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time

CLAVE = 'extensionsIdentifiers/disabled'


def rutas():
    """Donde viven la base de estado y el listado de extensiones, segun el sistema."""
    if sys.platform == 'win32':
        base = os.path.join(os.environ.get('APPDATA', ''), 'Code')
    elif sys.platform == 'darwin':
        base = os.path.expanduser('~/Library/Application Support/Code')
    else:
        base = os.path.expanduser('~/.config/Code')
    return (
        os.path.join(base, 'User', 'globalStorage', 'state.vscdb'),
        os.path.expanduser('~/.vscode/extensions/extensions.json'),
    )


def vscode_abierto():
    """True si hay un VS Code corriendo. Escribir con el abierto no serviria de nada."""
    try:
        if sys.platform == 'win32':
            salida = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq Code.exe'],
                                    capture_output=True, text=True, timeout=15).stdout
            return 'Code.exe' in salida
        salida = subprocess.run(['pgrep', '-f', 'Visual Studio Code|/Code'],
                                capture_output=True, text=True, timeout=15).stdout
        return bool(salida.strip())
    except Exception:
        return False                      # sin poder comprobarlo, no se bloquea al usuario


def instaladas(ruta):
    """Identificadores instalados, con su uuid cuando lo tienen."""
    try:
        with open(ruta, encoding='utf-8') as f:
            datos = json.load(f)
    except Exception:
        return {}
    fuera = {}
    for e in datos:
        ident = (e or {}).get('identifier') or {}
        if ident.get('id'):
            fuera[ident['id'].lower()] = {'id': ident['id'], 'uuid': ident.get('uuid')}
    return fuera


def leer_desactivadas(db):
    con = sqlite3.connect(db)
    try:
        fila = con.execute('SELECT value FROM ItemTable WHERE key = ?', (CLAVE,)).fetchone()
    finally:
        con.close()
    if not fila or not fila[0]:
        return []
    try:
        valor = json.loads(fila[0])
        return valor if isinstance(valor, list) else []
    except json.JSONDecodeError:
        return []


def escribir_desactivadas(db, lista):
    # Con segundos bastaba hasta que dos cambios seguidos cayeron en el mismo: el segundo
    # respaldo pisaba al primero y se perdia el estado anterior.
    sello = time.strftime('%Y%m%d-%H%M%S')
    copia = f'{db}.gg-{sello}.bak'
    n = 2
    while os.path.exists(copia):
        copia = f'{db}.gg-{sello}-{n}.bak'
        n += 1
    shutil.copy2(db, copia)
    con = sqlite3.connect(db)
    try:
        con.execute('INSERT INTO ItemTable (key, value) VALUES (?, ?) '
                    'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
                    (CLAVE, json.dumps(lista, separators=(',', ':'))))
        con.commit()
    finally:
        con.close()
    return copia


def main():
    p = argparse.ArgumentParser(description='Activa y desactiva extensiones de VS Code.')
    p.add_argument('accion', choices=['list', 'status', 'disable', 'enable'])
    p.add_argument('ids', nargs='*', help='identificadores editor.nombre')
    p.add_argument('--all', action='store_true', help='con enable: reactiva todas')
    p.add_argument('--force', action='store_true', help='escribir aunque VS Code este abierto')
    args = p.parse_args()

    db, lista_ext = rutas()
    if not os.path.exists(db):
        sys.exit(f'No encuentro la base de estado de VS Code:\n  {db}')

    desactivadas = leer_desactivadas(db)
    apagadas = {(e.get('id') or '').lower() for e in desactivadas if isinstance(e, dict)}
    catalogo = instaladas(lista_ext)

    if args.accion == 'status':
        if not desactivadas:
            print('No hay ninguna extension desactivada.')
        for e in desactivadas:
            print('  ' + (e.get('id') if isinstance(e, dict) else str(e)))
        return

    if args.accion == 'list':
        if not catalogo:
            print(f'No pude leer {lista_ext}')
        for clave in sorted(catalogo):
            print(('  [ apagada ]  ' if clave in apagadas else '  [ activa  ]  ') + catalogo[clave]['id'])
        return

    # A partir de aqui se escribe.
    if not args.ids and not (args.accion == 'enable' and args.all):
        sys.exit('Indica al menos un identificador. Usa "list" para verlos.')
    if vscode_abierto() and not args.force:
        sys.exit('VS Code esta abierto. Cierralo del todo y vuelve a ejecutarlo:\n'
                 '  lo que se escriba ahora lo sobreescribiria el editor al salir.')

    if args.accion == 'enable' and args.all:
        nueva = []
        print(f'Reactivadas {len(desactivadas)} extensiones.')
    elif args.accion == 'enable':
        pedidos = {i.lower() for i in args.ids}
        nueva = [e for e in desactivadas if (e.get('id') or '').lower() not in pedidos]
        for i in args.ids:
            print(('  reactivada  ' if i.lower() in apagadas else '  no estaba apagada  ') + i)
    else:
        nueva = list(desactivadas)
        for i in args.ids:
            clave = i.lower()
            if clave in apagadas:
                print('  ya estaba apagada  ' + i)
                continue
            if clave in catalogo:
                nueva.append({k: v for k, v in catalogo[clave].items() if v})
                print('  desactivada  ' + catalogo[clave]['id'])
            else:
                # Las que trae VS Code de fabrica (References, Emmet...) no estan en la
                # carpeta del usuario y no tienen uuid. VS Code las acepta solo con el id,
                # que es lo mismo que escribe al deshabilitarlas desde su propia vista.
                nueva.append({'id': i})
                print('  desactivada (integrada en VS Code)  ' + i)

    if nueva == desactivadas:
        print('Sin cambios.')
        return
    copia = escribir_desactivadas(db, nueva)
    print(f'\nHecho. Copia de seguridad en:\n  {copia}\nAbre VS Code para verlo.')


if __name__ == '__main__':
    main()
