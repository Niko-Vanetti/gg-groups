<div align="center">

<img src="media/gg-groups.svg" width="112" alt="GG Groups">

# GG Groups

**Toda tu barra de actividad en un panel — nunca más nada escondido tras los `…`.**

[![pruebas](https://img.shields.io/badge/pruebas-158%20pasando-2E8FE6)](test)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.74%2B-1565C0)](https://code.visualstudio.com/)
[![licencia](https://img.shields.io/badge/licencia-MIT-4FC3F7)](LICENSE)

[English](README.md) · **Español**

</div>

---

## El problema

Instala suficientes extensiones y la barra de actividad de VS Code se rinde. Los iconos
empiezan a esconderse en un menú `…`, y los que de verdad usas acaban a tres clics de
distancia. VS Code no permite agruparlos, y ninguna extensión puede hacerlo: esa barra es
interfaz interna del editor, cerrada a la API de extensiones.

## Qué hace GG Groups

Reconstruye la barra como un panel que sí es tuyo. **Todos los iconos a la vez**, y carpetas
que creas de la forma evidente: arrastras un icono sobre otro, le pones nombre, listo.

<div align="center">

| | |
|---|---|
| **Verlo todo** | Cada contenedor de la barra lateral, sin menú de desbordamiento |
| **Agrupar arrastrando** | Icono sobre icono crea una carpeta. Ese es el gesto entero |
| **Reordenar como la barra real** | Por el borde se coloca entre iconos, por el centro se agrupa |
| **Apilar los repetidos** | Tres iconos llamados *Claude Code* se juntan en uno con un **3** |
| **Renombrar lo que sea** | Iconos y carpetas, con el nombre que a ti te sirva |
| **Esconder el ruido** | Clic derecho → ocultar. El botón del ojo los devuelve todos |
| **Las apagadas siguen a la vista** | Al desactivar una queda en gris al fondo en vez de desaparecer, a un clic de volver |
| **Bloque nativo, blindado** | Explorador, Buscar, Control de código fuente, Ejecutar y depurar, Extensiones — fijos arriba, en el orden de VS Code, imposibles de romper |

</div>

## Instalación

Todavía no está publicada en el marketplace. Clona y copia a tu carpeta de extensiones:

```bash
git clone https://github.com/Niko-Vanetti/gg-groups.git
cd gg-groups
# Windows
cp -r package.json package.nls*.json extension.js media l10n ~/.vscode/extensions/gg-groups
# macOS / Linux — misma ruta, VS Code lee ~/.vscode/extensions en todas las plataformas
```

Después recarga VS Code (`Ctrl+Shift+P` → *Developer: Reload Window*) y pulsa el icono de
**GG Groups**.

## Cómo se usa

| Gesto | Qué pasa |
|---|---|
| **Clic en un icono** | Abre el panel de esa extensión |
| **Arrastrar icono → icono** | Crea una carpeta con los dos |
| **Arrastrar a la cabecera de una carpeta** | Lo mete dentro |
| **Arrastrar a un borde** | Lo coloca entre dos iconos |
| **Arrastrar al vacío** | Lo saca de su carpeta |
| **Clic derecho en un icono** | Renombrar · desactivar ahora · desactivar · copiar la orden · desinstalar · ocultar |
| **Clic derecho en una carpeta** | Ordenar A–Z · renombrar · eliminar |
| **＋ A↓ ◉ ⇥ ↻** | Nueva carpeta · ordenar todo · ver ocultos · llevar a la barra derecha · actualizar |

### Para tenerlo siempre visible

La barra lateral principal muestra un contenedor cada vez, así que al pulsar un icono el
tablero se cierra. Llévalo a la **barra lateral secundaria** y se queda fijo mientras todo lo
demás se abre a la izquierda. GG Groups lo intenta solo la primera vez; si tu versión de VS
Code no expone ese comando, pulsa **⇥** o arrastra el icono allí una vez — se recuerda para
siempre.

### Desactivar una de verdad, desde un guion

VS Code no deja que una extensión desactive a otra, y de su CLI lo dice la propia ayuda de
`--disable-extension`: *"no se persiste y solo tiene efecto en la ventana que abre ese
comando"*. Pero la lista sí vive en la base de estado global de VS Code, bajo la clave
`extensionsIdentifiers/disabled`, y eso sí se puede editar:

```bash
python scripts/gg-extensions.py list                # lo que tienes, y qué está activo
python scripts/gg-extensions.py disable ms-vscode.cmake-tools vscjava.vscode-gradle
python scripts/gg-extensions.py enable --all
```

**VS Code tiene que estar cerrado** — mantiene esa base en memoria y la vuelca al salir, así
que lo que se escriba con el editor abierto se pierde. El guion se niega a seguir si lo
encuentra abierto, y guarda una copia con fecha antes de cada escritura.

Desde el tablero no hace falta escribir nada: clic derecho en un icono y **Desactivar ahora**.
GG Groups lanza un proceso aparte que espera a que VS Code se cierre, aplica el cambio y lo
vuelve a abrir. Tú solo confirmas.

Recargar la ventana no sirve como atajo: eso reinicia la ventana y el host de extensiones,
pero no el proceso principal de VS Code, que es quien tiene esa base en memoria. Hace falta
cerrarlo del todo, y por eso el flujo automático lo cierra y lo reabre.

Si prefieres hacerlo a mano, *Copiar la orden* deja la línea exacta en el portapapeles.

## Decisiones de diseño que conviene saber

**Refleja tus barras laterales, no tu lista de extensiones.** Un tema o un paquete de idioma
no aporta icono, así que no aparece. Tampoco lo que vive en el panel inferior: eso no es una
barra lateral.

**Los iconos muertos se filtran.** Las vistas detrás de una cláusula `when` que no se cumple,
los contenedores sin ninguna vista y los comandos que VS Code no tiene registrados no llegan
al tablero. Cuando la condición depende de una clave de contexto de otra extensión —
imposible de consultar desde fuera — se muestra el icono en vez de descartarlo a ciegas.

**Iconos de verdad, dibujos de verdad.** Primero el logo del marketplace, luego el icono que
la extensión pone en su barra, luego el codicon oficial correspondiente (los 639 se
distribuyen con la extensión), y solo entonces una letra. Los dibujos de un solo color se
pintan con el color de tu tema en lugar de salir en negro.

**Sigue el idioma de tu sistema, no el de VS Code.** Incluye español e inglés. En Windows el
host de extensiones informa del idioma de VS Code y no del sistema, así que se le pregunta
directamente a Windows.

**Desactivar es cosa de VS Code, no nuestra.** Ninguna API deja que una extensión desactive
a otra, y los comandos del workbench o no existen o aceptan la llamada y la ignoran en
silencio. Así que GG Groups te lleva a la ficha de la extensión, donde el botón sí funciona,
e informa del estado por el hecho y no por la intención: un icono se pone en gris cuando VS
Code deja de cargarlo de verdad, lo hayas apagado desde donde lo hayas apagado. Desinstalar
sí se puede por código, así que eso ocurre en el sitio, tras una confirmación que dice claro
que borra la extensión del disco.

**Tu configuración es tuya.** Carpetas, orden, nombres, ocultos y apagados viven en el
almacenamiento de la extensión. No se escribe nada en tus ajustes, y nada sale de tu equipo.

## Compruébalo tú mismo

Ejecuta **`GG Groups: Comprobar que todo funciona`** desde la paleta de comandos. Recorre cada
baldosa, confirma que el archivo de cada icono existe en el disco y que cada comando está
registrado, informa de si tu versión permite apagar extensiones y mover el panel a la barra
derecha, y verifica que el estado guardado es coherente.

## Desarrollo

```bash
npm install
npm test      # 158 pruebas, sin necesidad de VS Code
```

La suite ejecuta el `extension.js` real contra una API de VS Code simulada, y el webview real
dentro de jsdom, sobre un conjunto fijo de manifiestos de mentira — así da el mismo resultado
en cualquier máquina. Cubre el descubrimiento y el filtrado, arrastrar y soltar, las carpetas
y el bloque nativo bloqueado, el apilado, ocultar, renombrar, el interruptor de encendido, la
evaluación de `when`, la detección de idioma y todos los caminos de error.

## Licencia

MIT — ver [LICENSE](LICENSE).
