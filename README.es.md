<div align="center">

<img src="media/gg-groups.svg" width="112" alt="GG Groups">

# GG Groups

**Toda tu barra de actividad en un panel — nunca más nada escondido tras los `…`.**

[![pruebas](https://img.shields.io/badge/pruebas-186%20pasando-2E8FE6)](test)
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
| **Esconder el ruido** | Clic derecho → ocultar. El ojo del pie los devuelve todos |
| **Trabajar por grupos** | **Alt+clic** elige varios: se arrastran juntos, se apagan juntos, se desinstalan juntos |
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
| **Alt+clic en un icono** | Lo añade o lo quita de la selección |
| **Alt+clic en una pila** | Elige de una vez todas las que hay debajo |
| **Arrastrar uno elegido** | Se lleva a todos los elegidos |
| **Clic derecho en un icono** | Renombrar · desactivar · desinstalar · ocultar |
| **Clic derecho en una carpeta** | Ordenar A–Z · renombrar · eliminar |
| **Botones del pie** | Nueva carpeta · ordenar todo · ojo (ver ocultos) · pausa/play (apagar o encender lo elegido) · papelera (desinstalar lo elegido) · actualizar |

### Elegir varios

**Alt+clic** sobre los iconos los va añadiendo a la selección. Con varios elegidos, arrastrar
uno se los lleva a todos, y los botones del pie actúan sobre el grupo entero: **pausa** los
apaga, **play** los enciende, la **papelera** los desinstala. Un clic normal suelta la
selección.

**Pausa** y **play** son el botón de aplicar: enumeran qué va a pasar, cierran VS Code, lo
aplican y lo vuelven a abrir. Todo en un solo cierre, por muchas que elijas. Si cancelas, no
pasa nada.

Pulsar una extensión apagada no la enciende: te dice que está desactivada. Encenderla es
deliberado — la eliges con Alt+clic y pulsas play.

El botón de pausa/play sabe qué toca: aparece como pausa si todo lo elegido está encendido, y
como play si todo está apagado. Si mezclas encendidas y apagadas se pone gris — no hay una
acción sensata que aplicar a todas, y elegir por su cuenta sería peor que no hacer nada.

### Para tenerlo siempre visible

La barra lateral principal muestra un contenedor cada vez, así que al pulsar un icono el
tablero se cierra. Llévalo a la **barra lateral secundaria** y se queda fijo mientras todo lo
demás se abre a la izquierda. GG Groups lo intenta solo la primera vez; si tu versión de VS
Code no expone ese comando, arrastra el icono allí una vez — se recuerda para siempre.

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

Desde el tablero no hace falta escribir nada. Eliges los iconos con **Alt+clic** y pulsas
**pausa**: GG Groups te enumera lo que va a pasar y, al confirmar, lanza un proceso aparte
que espera a que VS Code se cierre, escribe todos los cambios de una vez y lo vuelve a
abrir. Un solo cierre para todas, no uno por extensión. Para una sola, clic derecho →
**Desactivar la extensión**, que hace lo mismo.

Se abre una ventana visible que va contando lo que hace, y **es ella quien vuelve a abrir
VS Code**: si lo abres tú antes de tiempo, el guion se encuentra el editor otra vez en
marcha y no escribe nada — escribir entonces sería inútil, porque VS Code lo pisaría al
salir. Si eso pasa, la ventana espera a que lo cierres en vez de rendirse. Todo queda
además en un registro que `GG Groups: Comprobar que todo funciona` te lee.

Recargar la ventana no vale como atajo. *Developer: Reload Window* reinicia la ventana y el
host de extensiones, pero no el proceso principal de VS Code, que es justamente quien tiene
esa base en memoria y la vuelca al salir: lo que se escribiera antes de recargar quedaría
pisado. Por eso hay que cerrarlo del todo.

Si no tienes Python, GG Groups no finge: avisa y deja la orden completa en el portapapeles
para ejecutarla a mano.

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

**Desactivar se marca y se aplica en bloque.** Ninguna API deja que una extensión desactive a
otra, y los comandos del workbench o no existen o aceptan la llamada y la ignoran en silencio.
Lo único que funciona es escribir en la base de estado con VS Code cerrado — y como cerrarlo
es caro, no se hace una vez por extensión: marcas todas y se aplican en un solo cierre. Hasta
entonces no ha cambiado nada, y el tablero sigue diciendo la verdad: un icono se pone en gris
cuando VS Code deja de cargarlo de verdad, lo hayas apagado desde donde lo hayas apagado.
Desinstalar sí se puede por código, así que eso ocurre en el sitio, tras una confirmación que
dice claro que borra la extensión del disco.

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
npm test      # 186 pruebas, sin necesidad de VS Code
```

La suite ejecuta el `extension.js` real contra una API de VS Code simulada, y el webview real
dentro de jsdom, sobre un conjunto fijo de manifiestos de mentira — así da el mismo resultado
en cualquier máquina. Cubre el descubrimiento y el filtrado, arrastrar y soltar, las carpetas
y el bloque nativo bloqueado, el apilado, ocultar, renombrar, el interruptor de encendido, la
evaluación de `when`, la detección de idioma y todos los caminos de error.

## Licencia

MIT — ver [LICENSE](LICENSE).
