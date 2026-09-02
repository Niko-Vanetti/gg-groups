const vscode = require('vscode');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const path = require('path');
const { execFile, spawn } = require('child_process');

const KEY_FOLDERS = 'viewGroups.folders';
const KEY_ORDER = 'viewGroups.order';
const KEY_NAMES = 'viewGroups.names';
const KEY_HIDDEN = 'viewGroups.hidden';
const KEY_SHOW_HIDDEN = 'viewGroups.showHidden';
const KEY_SEEDED = 'viewGroups.seeded';
const KEY_DOCKED = 'viewGroups.docked';
const KEY_LOCALE = 'viewGroups.locale';
// Catalogo de lo que se ha visto alguna vez, para reconocer lo que ya no esta cargado.
const KEY_SEEN = 'viewGroups.seen';
const KEY_OFF = 'viewGroups.off';
const KEY_FACE = 'viewGroups.face';                     // que icono da la cara por su grupo
const KEY_MERGED = 'viewGroups.merged';                 // iconos que el usuario junto
const KEY_SPLIT = 'viewGroups.split';                   // y los que saco de su familia
const KEY_QUEUE = 'viewGroups.queue';                   // solo para limpiar el estado de versiones viejas
const KEY_REMOVED = 'viewGroups.removed';               // solo para limpiar el estado de versiones viejas
/**
 * Desactivar una extension NO se puede hacer por codigo: no hay API, y los comandos de
 * `workbench` o no existen o aceptan la llamada y la ignoran sin avisar — resuelven bien
 * y no desactivan nada. Fiarse de eso llevaba a pintar en gris extensiones que seguian
 * cargandose en cada arranque. Asi que el estado ya no se supone: una extension figura
 * apagada solo cuando VS Code deja de cargarla de verdad, y para apagarla se lleva al
 * usuario a su ficha, donde el boton si funciona.
 */
const EXT_PAGE_CMDS = ['extension.open', 'workbench.extensions.search'];
/**
 * Desinstalar si se puede por codigo, y es lo unico que hace que una extension deje de
 * cargarse sin pasar por la interfaz. No es lo mismo que desactivar: borra la extension
 * del disco, asi que se pide confirmacion antes.
 */
const UNINSTALL_CMDS = ['workbench.extensions.uninstallExtension'];
const INSTALL_CMDS = ['workbench.extensions.installExtension'];
// VS Code ha ido cambiando el nombre de este comando; se busca por patron en vez de fijarlo.
const MOVE_RIGHT = /^workbench\.action\.move.*View.*(SecondarySideBar|AuxiliaryBar)$/i;
// Las dos barras laterales, y solo esas: lo que vive en el panel de abajo no es un icono de barra.
const SIDEBARS = /^(activitybar|secondarysidebar|auxiliarybar)$/i;
/**
 * Contenedores de depuracion que trae VS Code de fabrica. Sus vistas estan detras de
 * ajustes apagados (github.copilot.chat.showLogView y showContextInspectorView), asi que
 * en la barra real no aparecen y pulsarlos aqui no abriria nada.
 */
const DEV_CONTAINERS = new Set(['copilot-chat', 'context-inspector']);
// Un comando de foco que no responde en este tiempo se da por colgado.
const OPEN_TIMEOUT = 4000;
// Margen para que el workbench termine de enfocar la vista antes de moverla.
const FOCUS_DELAY = 200;
/**
 * Los iconos que VS Code trae de fabrica en su barra de actividad, en su orden exacto
 * y con sus dibujos autenticos (los codicons oficiales que se distribuyen en media/codicons).
 * Este bloque va bloqueado: ni se reordena ni se toca.
 */
const NATIVE = [
  ['n:explorer', 'workbench.view.explorer', 'Explorer', 'files'],
  ['n:search', 'workbench.view.search', 'Search', 'search'],
  ['n:scm', 'workbench.view.scm', 'Source Control', 'source-control'],
  ['n:debug', 'workbench.view.debug', 'Run and Debug', 'debug-alt'],
  ['n:extensions', 'workbench.view.extensions', 'Extensions', 'extensions'],
];
const NATIVE_KEYS = NATIVE.map(([k]) => k);

/**
 * Iconos de las barras laterales que VS Code monta por su cuenta, sin declararlos en
 * ningun manifiesto: el chat es el caso claro. Solo se anaden si nadie los aporta ya
 * y si su comando existe de verdad en esta instalacion.
 */
/**
 * Iconos que VS Code pone en la barra sin pasar por el manifiesto de nadie. El cuarto dato
 * es la extension que los llena cuando la hay: el Explorador remoto es un contenedor del
 * propio VS Code, pero quien lo alimenta es una extension instalada. Sin ese apunte salia
 * dos veces —una aqui y otra entre las pasivas— y encima no habia forma de apagarla.
 */
const CORE = [
  ['k:chat', 'workbench.action.chat.open', 'Chat', 'copilot'],
  ['k:testing', 'workbench.view.testing', 'Testing', 'beaker'],
  ['k:remote', 'workbench.view.remote', 'Remote Explorer', 'remote-explorer', 'ms-vscode.remote-explorer'],
];

/**
 * VS Code unifico el chat: `workbench.action.chat.open` abre UN solo panel, y quien
 * responde ahi es el proveedor activo — si hay una extension que aporta sesiones de chat
 * (ChatGPT/Codex lo hace), puede ser ella y no Copilot. Si esta instalacion todavia
 * expone un comando propio de Copilot, se prefiere ese para que el icono sea inequivoco.
 */
const CHAT_SPECIFIC = [
  /^workbench\.panel\.chat\.view\.copilot\.focus$/i,
  /^github\.copilot\.chat\.focus$/i,
  /^workbench\.action\.chat\.openInSidebar$/i,
];

// --- idioma ---
// A proposito NO se usa vscode.l10n: ese sigue el idioma de VS Code, y aqui queremos
// el del sistema operativo. En Windows no hay LANG, pero el locale de ICU si lo refleja.
let STRINGS = {};
let LANG = 'en';                                          // idioma activo, para leer los nombres de la tienda

function systemLocale() {
  const env = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG;
  if (env && env !== 'C' && env !== 'POSIX') return env.split(/[._@-]/)[0].toLowerCase();
  try {
    return new Intl.DateTimeFormat().resolvedOptions().locale.split('-')[0].toLowerCase();
  } catch {
    return String(vscode.env.language || 'en').split('-')[0].toLowerCase();
  }
}

function loadStrings(ctx, locale) {
  const lang = locale || systemLocale();
  LANG = lang;
  STRINGS = {};
  if (lang === 'en') return lang;                     // el codigo ya esta en ingles
  try {
    const p = vscode.Uri.joinPath(ctx.extensionUri, 'l10n', `bundle.l10n.${lang}.json`);
    STRINGS = JSON.parse(fs.readFileSync(p.fsPath, 'utf8'));
  } catch { /* sin traduccion para ese idioma: se queda en ingles */ }
  return lang;
}

/**
 * En Windows el locale de ICU que ve el host de extensiones sigue al idioma de VS Code,
 * no al del sistema, asi que hay que preguntarle al propio Windows. Se hace una sola vez
 * y se guarda, para no pagar el arranque de PowerShell en cada sesion.
 */
async function osLocale(ctx) {
  const cached = ctx.globalState.get(KEY_LOCALE);
  if (typeof cached === 'string' && cached) return cached;
  let lang = systemLocale();
  if (process.platform === 'win32') {
    try {
      const out = await new Promise((res, rej) => execFile(
        'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-Culture).Name'],
        { timeout: 5000, windowsHide: true }, (e, so) => (e ? rej(e) : res(so))
      ));
      const m = String(out).trim().split(/[-_]/)[0].toLowerCase();
      if (/^[a-z]{2}$/.test(m)) lang = m;
    } catch (e) {
      console.error('[GG Groups] no se pudo leer la cultura de Windows:', e);
    }
  }
  await ctx.globalState.update(KEY_LOCALE, lang);
  return lang;
}

const t = (s, ...a) => String(STRINGS[s] || s).replace(/\{(\d)\}/g, (_, i) => a[i]);

// VS Code ya resuelve las claves NLS del packageJSON; si alguna queda como %clave%, usa el id.
const label = (s, id) => (typeof s !== 'string' || !s || /^%.*%$/.test(s) ? id : s);

/**
 * Donde VS Code guarda lo que instalas desde la tienda: la carpeta que contiene a esta
 * misma extension, porque vive ahi dentro. Se deduce en vez de darla por sabida — asi
 * vale igual con --extensions-dir, con una instalacion portable o con varios perfiles.
 * Sin registro no hay pasivas y ya esta; adivinar una ruta seria leer lo que no toca.
 */
function extensionsDir(ctx) {
  const propia = ctx && ctx.extensionUri && ctx.extensionUri.fsPath;
  return propia ? path.dirname(propia) : null;
}

/** El nombre que se ve en la tienda, resolviendo los %marcadores% de traduccion. */
function displayName(dir, pkg) {
  const crudo = pkg.displayName || pkg.name || '';
  const clave = /^%(.+)%$/.exec(crudo);
  if (!clave) return crudo;
  for (const f of [`package.nls.${LANG}.json`, 'package.nls.json']) {
    try {
      const nls = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const v = nls[clave[1]];
      if (typeof v === 'string' && v) return v;
      if (v && typeof v.message === 'string') return v.message;
    } catch { /* sin ese archivo, se prueba el siguiente */ }
  }
  return pkg.name || crudo;
}

/**
 * Todo lo instalado desde la tienda, tenga icono en la barra o no. Es la misma lista que
 * VS Code enseña en "Installed", y sale de su propio registro y no de extensions.all,
 * porque ahi no estan las que ya se apagaron — y son justo las que hay que poder volver
 * a encender.
 */
function installedExtensions(ctx) {
  const dir = extensionsDir(ctx);
  if (!dir) return [];
  let registro;
  try {
    registro = JSON.parse(fs.readFileSync(path.join(dir, 'extensions.json'), 'utf8'));
  } catch (e) {
    // Que no haya registro es lo normal fuera de una instalacion (ejecutando desde el
    // codigo, en las pruebas): no hay pasivas y ya esta. Solo se avisa de lo demas.
    if (!e || e.code !== 'ENOENT') console.error('[GG Groups] registro de extensiones ilegible', e);
    return [];
  }
  if (!Array.isArray(registro)) return [];

  const fuera = [];
  const vistos = new Set();
  for (const e of registro) {
    const id = ((e || {}).identifier || {}).id;
    const rel = (e || {}).relativeLocation;
    if (!id || !rel || vistos.has(id.toLowerCase())) continue;
    vistos.add(id.toLowerCase());
    const carpeta = path.join(dir, rel);
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(carpeta, 'package.json'), 'utf8'));
    } catch {
      continue;                                     // carpeta a medias: no se inventa nada
    }
    fuera.push({
      ext: id,
      // Lo que ese paquete arrastro consigo al instalarse: Java se instala una vez y
      // aparecen seis. En la barra son seis iconos, pero para el usuario son una cosa.
      pack: Array.isArray(pkg.extensionPack) ? pkg.extensionPack : [],
      installed: (e.metadata || {}).installedTimestamp || 0,
      version: e.version || pkg.version || '',
      label: displayName(carpeta, pkg) || id,
      owner: (e.metadata || {}).publisherDisplayName || pkg.publisher || '',
      icon: pickIcon(ctx, vscode.Uri.file(carpeta), pkg.icon, null),
    });
  }
  return fuera;
}

/**
 * La consulta al mercado, tal como la hace VS Code. Se devuelve armada en vez de enviarse
 * para poder comprobarla sin salir a la red: lo que viaja son los identificadores de las
 * extensiones y nada mas.
 */
function marketplaceQuery(ids) {
  return JSON.stringify({
    filters: [{
      criteria: [
        { filterType: 8, value: 'Microsoft.VisualStudio.Code' },
        ...ids.map((id) => ({ filterType: 7, value: id })),
      ],
      pageNumber: 1,
      pageSize: Math.max(ids.length, 1),
    }],
    // Solo la ultima version de cada una: no hace falta el historial para comparar.
    flags: 0x1 | 0x200,
  });
}

/** Compara versiones al estilo 1.10.2 > 1.9.9, sin tratarlas como texto. */
function newerVersion(a, b) {
  const trozos = (v) => String(v || '').split('.').map((n) => parseInt(n, 10) || 0);
  const x = trozos(a), y = trozos(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}

/**
 * De la respuesta del mercado a "esta tiene version nueva". `instaladas` es un mapa de
 * identificador a la version que hay puesta ahora mismo.
 */
function parseUpdates(cuerpo, instaladas) {
  const fuera = new Map();
  let datos;
  try {
    datos = typeof cuerpo === 'string' ? JSON.parse(cuerpo) : cuerpo;
  } catch {
    return fuera;
  }
  for (const r of ((datos || {}).results || [])) {
    for (const e of (r.extensions || [])) {
      const id = `${((e.publisher || {}).publisherName) || ''}.${e.extensionName || ''}`.toLowerCase();
      const puesta = instaladas.get(id);
      if (!puesta) continue;
      // Las versiones de vista previa no cuentan como actualizacion: quien las quiere se
      // las instala a mano, y ofrecerlas aqui cambiaria el canal sin avisar.
      const estable = (e.versions || []).find((v) => !((v.properties || []).some(
        (pr) => pr.key === 'Microsoft.VisualStudio.Code.PreRelease' && pr.value === 'true')));
      const ultima = (estable || (e.versions || [])[0] || {}).version;
      if (ultima && newerVersion(ultima, puesta)) fuera.set(id, ultima);
    }
  }
  return fuera;
}

/**
 * Pregunta al mercado que hay de nuevo. Es la unica parte de GG Groups que sale a la red,
 * y solo ocurre cuando el usuario lo pide expresamente.
 */
function fetchUpdates(ids, instaladas) {
  const cuerpo = marketplaceQuery(ids);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'marketplace.visualstudio.com',
      path: '/_apis/public/gallery/extensionquery',
      method: 'POST',
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json;api-version=3.0-preview.1',
        'Content-Length': Buffer.byteLength(cuerpo),
      },
    }, (res) => {
      let texto = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { texto += c; });
      res.on('end', () => (res.statusCode === 200
        ? resolve(parseUpdates(texto, instaladas))
        : reject(new Error('HTTP ' + res.statusCode))));
    });
    req.on('timeout', () => req.destroy(new Error(t('it did not respond'))));
    req.on('error', reject);
    req.end(cuerpo);
  });
}

const HUELLAS = new Map();

/**
 * Conjuntos que se van uniendo. Sirve para juntar en una sola familia lo que llego junto
 * en un paquete y lo que ademas comparte dibujo, sin importar en que orden se descubra.
 */
function familias() {
  const padre = new Map();
  const raiz = (a) => {
    while (padre.get(a) && padre.get(a) !== a) a = padre.get(a);
    return a;
  };
  return {
    raiz: (a) => (padre.has(a) ? raiz(a) : a),
    unir(a, b) {
      if (!a || !b || a === b) return;
      if (!padre.has(a)) padre.set(a, a);
      if (!padre.has(b)) padre.set(b, b);
      const x = raiz(a), y = raiz(b);
      if (x !== y) padre.set(x, y);
    },
  };
}

/**
 * La huella del archivo del icono. Se agrupa por el dibujo y no por el nombre porque es
 * lo que se ve: C/C++, sus temas y su paquete son tres extensiones distintas con el mismo
 * logo, y en la barra parecen —y son— lo mismo. Sin icono se cae al nombre, que es como
 * se agrupaban antes los tres "Claude Code".
 */
function iconGroup(icon, label) {
  const ruta = icon && icon.uri && icon.uri.fsPath;
  if (!ruta) return 'name:' + String(label || '').trim().toLowerCase();
  if (HUELLAS.has(ruta)) return HUELLAS.get(ruta);
  let clave;
  try {
    clave = 'icon:' + crypto.createHash('sha1').update(fs.readFileSync(ruta)).digest('hex').slice(0, 16);
  } catch {
    clave = 'file:' + ruta;                      // ilegible: al menos no se mezcla con otro
  }
  HUELLAS.set(ruta, clave);
  return clave;
}

/** El dibujo oficial de un codicon, si existe entre los que se distribuyen. */
function codiconIcon(ctx, name) {
  const uri = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'codicons', name + '.svg');
  try {
    return fs.existsSync(uri.fsPath) ? { uri, mask: true } : null;
  } catch {
    return null;
  }
}

/**
 * Lee una clave `config.x.y` de una clausula `when`. Devuelve null si el ajuste no
 * existe en esta instalacion, porque entonces no sabemos que valdria.
 */
function readConfig(token) {
  if (!/^config\./.test(token)) return null;          // context key: no se puede consultar
  const key = token.slice('config.'.length);
  try {
    const info = vscode.workspace.getConfiguration().inspect(key);
    if (!info) return null;
    for (const v of [info.workspaceFolderValue, info.workspaceValue, info.globalValue, info.defaultValue]) {
      if (v !== undefined) return v;
    }
  } catch { /* sin API de ajustes */ }
  return null;
}

/** El primer intérprete de Python que responda, o null si no hay ninguno. */
async function findPython() {
  const candidatos = process.platform === 'win32'
    ? ['python', 'py', 'python3']
    : ['python3', 'python'];
  for (const exe of candidatos) {
    const args = exe === 'py' ? ['-3', '--version'] : ['--version'];
    const vale = await new Promise((res) => {
      try {
        execFile(exe, args, { timeout: 5000, windowsHide: true }, (err) => res(!err));
      } catch {
        res(false);
      }
    });
    if (vale) return exe;
  }
  return null;
}

/**
 * La orden que aplica toda la lista de una vez, cuando VS Code ya se haya cerrado. Se
 * devuelve en vez de ejecutarse para poder comprobarla en las pruebas sin cerrarle el
 * editor a nadie.
 *
 * En Windows se pasa por `cmd /c start` a proposito. Lanzar powershell.exe directamente
 * con detached hace que Windows no le de consola ninguna: el proceso corre invisible, y
 * si algo va mal —por ejemplo, que VS Code vuelva a abrirse antes de tiempo— el aviso no
 * lo ve nadie y parece que la extension no hizo nada. Con `start` hay ventana de verdad.
 */
/**
 * El entorno con el que se lanza el proceso de fuera, sin lo que VS Code le pone al host
 * de extensiones. ELECTRON_RUN_AS_NODE es el que importa: con esa variable puesta, Code.exe
 * arranca como Node y no abre el editor — se hereda hasta el nieto, asi que la reapertura
 * no ocurria nunca. Las VSCODE_* apuntan a la instancia que se acaba de cerrar.
 */
function cleanEnv(env) {
  const fuera = {};
  for (const [k, v] of Object.entries(env || {})) {
    if (/^(ELECTRON_|VSCODE_)/.test(k)) continue;
    fuera[k] = v;
  }
  return fuera;
}

function restartCommand(plan) {
  const { dir, python, disable, enable, codeExe, log } = plan;
  const script = `${dir}/gg-extensions.py`;
  const apagar = (disable || []).join(',');
  const encender = (enable || []).join(',');
  if (process.platform === 'win32') {
    const ps = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `${dir}/gg-apply.ps1`,
                '-Python', python, '-Script', script, '-CodeExe', codeExe];
    // Los parametros vacios se omiten: pasarlos como "" a traves de cmd es pedir problemas.
    if (apagar) ps.push('-Disable', apagar);
    if (encender) ps.push('-Enable', encender);
    if (log) ps.push('-Log', log);
    return { exe: 'cmd.exe', args: ['/c', 'start', 'GG Groups', 'powershell.exe', ...ps], env: cleanEnv(process.env) };
  }
  // En macOS y Linux no hay ventana que abrir: el mismo bucle de espera, en sh.
  const espera = process.platform === 'darwin'
    ? 'while pgrep -x "Code Helper" >/dev/null 2>&1 || pgrep -x Electron >/dev/null 2>&1; do sleep 1; done'
    : 'while pgrep -f "/code" >/dev/null 2>&1; do sleep 1; done';
  const pasos = [];
  if (apagar) pasos.push(`"${python}" "${script}" disable --force ${(disable || []).join(' ')}`);
  if (encender) pasos.push(`"${python}" "${script}" enable --force ${(enable || []).join(' ')}`);
  return {
    exe: 'sh',
    args: ['-c', `${espera}; sleep 1; ${pasos.join('; ')}; "${codeExe}" || true`],
    env: cleanEnv(process.env),
  };
}

/** Ctrl fuera de Mac, Cmd dentro: el texto tiene que decir la tecla que de verdad vale. */
const modKey = (s) => (process.platform === 'darwin' ? s.replace(/Ctrl/g, 'Cmd') : s);

const literal = (s) => (s === 'true' ? true : s === 'false' ? false : s.replace(/^['"]|['"]$/g, ''));

/**
 * Evalua lo que se pueda de una clausula `when`: true, false, o null si depende de algo
 * que una extension no puede consultar (las context keys que fija otra extension).
 * Solo se usa para descartar lo que es *seguro* que esta apagado; ante la duda, se muestra.
 */
function whenValue(expr) {
  if (typeof expr !== 'string' || !expr.trim()) return true;
  if (expr.includes('||')) {
    const parts = expr.split('||').map(whenValue);
    if (parts.some((v) => v === true)) return true;
    return parts.every((v) => v === false) ? false : null;
  }
  if (expr.includes('&&')) {
    const parts = expr.split('&&').map(whenValue);
    if (parts.some((v) => v === false)) return false;
    return parts.every((v) => v === true) ? true : null;
  }
  let term = expr.trim(), neg = false;
  while (term.startsWith('!')) { neg = !neg; term = term.slice(1).trim(); }
  const cmp = term.match(/^(\S+)\s*(===|==|!==|!=)\s*(\S+)$/);
  let value;
  if (cmp) {
    const left = readConfig(cmp[1]);
    if (left === null) return null;
    const equal = left === literal(cmp[3]);
    value = cmp[2].startsWith('!') ? !equal : equal;
  } else {
    const raw = readConfig(term);
    if (raw === null) return null;
    value = !!raw;
  }
  return neg ? !value : value;
}

/**
 * Un contenedor solo sale en la barra si tiene alguna vista visible. Se descarta cuando
 * no declara ninguna, y cuando todas las que declara estan apagadas con certeza.
 */
function containerShows(views) {
  if (!views || !views.length) return false;          // sin vistas no hay nada que abrir
  return views.some((v) => whenValue(v && v.when) !== false);
}

/** Un archivo de la extension, solo si existe de verdad en el disco. */
function fileIcon(base, rel) {
  if (typeof rel !== 'string' || !rel.trim()) return null;
  const uri = vscode.Uri.joinPath(base, ...rel.split(/[\\/]+/).filter(Boolean));
  try {
    if (!fs.existsSync(uri.fsPath)) return null;
  } catch {
    return null;
  }
  return { uri, mask: /\.svg$/i.test(rel) };
}

/**
 * Resuelve el icono probando por orden y comprobando que el archivo exista: el logo del
 * marketplace, el icono que la extension pone en la barra (tema oscuro o claro), y su
 * version codicon. Antes se devolvia el primer candidato sin mirar si estaba ahi, y una
 * ruta mala dejaba la baldosa sin dibujo en vez de pasar a la siguiente.
 *
 * `mask` marca los dibujos de un solo color, que se pintan con el color del tema
 * en vez de mostrarse tal cual (si no, un SVG negro no se ve sobre fondo oscuro).
 */
function pickIcon(ctx, base, marketplace, sidebar) {
  const candidatos = [marketplace];
  if (sidebar && typeof sidebar === 'object') candidatos.push(sidebar.dark, sidebar.light);
  else candidatos.push(sidebar);

  for (const c of candidatos) {
    if (typeof c !== 'string' || !c) continue;
    const codicon = c.match(/^\$\(([\w-]+)\)$/);                  // p. ej. "$(key)"
    const found = codicon ? codiconIcon(ctx, codicon[1]) : fileIcon(base, c);
    if (found) return found;
  }
  return null;
}

/**
 * Una baldosa por cada icono de las barras laterales: los cinco de fabrica, los
 * contenedores que aportan las extensiones a la barra de actividad o a la secundaria,
 * y lo que VS Code monta ahi por su cuenta (el chat) si no lo aporta nadie.
 *
 * Queda fuera todo lo demas: el panel de abajo, las secciones que viven dentro de un
 * contenedor, los contenedores de depuracion y las extensiones sin icono (temas, idiomas).
 * Un manifiesto raro no puede tumbar la extension: cada uno va en su propio try.
 */

/**
 * Reparte las baldosas en familias. Se aplica sobre la lista entera —incluidas las apagadas,
 * que se reconstruyen aparte— porque agruparlas con otra regla las dejaba siempre solas:
 * dos iconos de la misma extension apagada salian uno al lado del otro, y una apagada nunca
 * se juntaba con su paquete.
 */
function assignGroups(unicas, instaladas, juntadas, separadas) {
  // Una familia por producto. Se unen tres cosas: lo que un paquete trajo consigo, lo
  // que comparte dibujo, y lo que el usuario haya juntado a mano. Lo que el usuario
  // separo a mano manda sobre las dos primeras.
  const sueltas = new Set((separadas || []).map((x) => String(x).toLowerCase()));
  const fam = familias();
  const suelta = (id) => sueltas.has(String(id).toLowerCase());
  for (const e of instaladas) {
    if (suelta(e.ext)) continue;
    for (const hijo of e.pack || []) if (!suelta(hijo)) fam.unir(e.ext.toLowerCase(), String(hijo).toLowerCase());
  }
  for (const e of vscode.extensions.all) {
    const pack = (e.packageJSON || {}).extensionPack;
    if (!Array.isArray(pack) || suelta(e.id)) continue;
    for (const hijo of pack) if (!suelta(hijo)) fam.unir(String(e.id).toLowerCase(), String(hijo).toLowerCase());
  }
  // El dibujo: lo que se ve igual va junto aunque se llame distinto.
  const porDibujo = new Map();
  for (const x of unicas) {
    if (x.native || !x.ext || x.ext === 'vscode' || suelta(x.ext)) continue;
    const d = iconGroup(x.icon, x.label);
    if (porDibujo.has(d)) fam.unir(porDibujo.get(d), x.ext.toLowerCase());
    else porDibujo.set(d, x.ext.toLowerCase());
  }
  for (const [a, b] of juntadas || []) {
    if (!suelta(a) && !suelta(b)) fam.unir(String(a).toLowerCase(), String(b).toLowerCase());
  }

  // La cara del grupo: la que trajo a las demas. No vale "la instalada primero" a secas —
  // en Java el paquete llego despues que dos de sus miembros—, asi que gana la que mas
  // arrastro consigo, y entre iguales la mas antigua.
  const trajo = new Map();
  const cuando = new Map();
  for (const e of instaladas) {
    cuando.set(e.ext.toLowerCase(), e.installed || 0);
    if ((e.pack || []).length) trajo.set(e.ext.toLowerCase(), e.pack.length);
  }
  for (const e of vscode.extensions.all) {
    const pack = (e.packageJSON || {}).extensionPack;
    if (Array.isArray(pack) && pack.length) {
      trajo.set(String(e.id).toLowerCase(), Math.max(trajo.get(String(e.id).toLowerCase()) || 0, pack.length));
    }
  }

  for (const x of unicas) {
    const id = String(x.ext || '').toLowerCase();
    // El bloque nativo y lo que es de VS Code van fijos y nunca se agrupan.
    x.group = x.native || !x.ext || x.ext === 'vscode'
      ? 'solo:' + x.key
      : suelta(x.ext) ? 'ext:' + id : 'fam:' + fam.raiz(id);
    x.brought = trajo.get(id) || 0;
    x.installed = cuando.get(id) || 0;
  }
}

function discover(ctx, juntadas, separadas) {
  const tiles = NATIVE.map(([key, cmd, name, icon]) => ({
    key, cmd, label: t(name), owner: 'Visual Studio Code', ext: 'vscode', native: true,
    icon: codiconIcon(ctx, icon),
  }));

  for (const ext of vscode.extensions.all) {
    try {
      const pkg = ext.packageJSON || {};
      if (ext.id === 'niko.view-groups') continue;
      const owner = label(pkg.displayName, pkg.name || ext.id);
      const views = (pkg.contributes || {}).views || {};

      for (const [where, list] of Object.entries((pkg.contributes || {}).viewsContainers || {})) {
        if (!SIDEBARS.test(where)) continue;              // el panel de abajo no cuenta
        for (const vc of list || []) {
          if (!vc || !vc.id || DEV_CONTAINERS.has(vc.id)) continue;
          if (!containerShows(views[vc.id])) continue;    // VS Code tampoco lo pinta
          tiles.push({
            key: `c:${vc.id}`, label: label(vc.title, vc.id), owner, ext: ext.id, where,
            cmd: `workbench.view.extension.${vc.id}`,
            icon: pickIcon(ctx, ext.extensionUri, pkg.icon, vc.icon),
          });
        }
      }
    } catch (e) {
      console.error('[GG Groups] manifiesto ilegible:', ext.id, e);
    }
  }

  // Y lo que VS Code pone en las barras sin pasar por un manifiesto, si aun falta.
  for (const [key, cmd, name, icon, backing] of CORE) {
    if (tiles.some((x) => x.cmd === cmd)) continue;
    // Si quien lo llena es una extension instalada, el icono es suyo: asi se puede apagar,
    // y no vuelve a aparecer ademas en la lista de pasivas.
    const suya = backing && vscode.extensions.all.find((e) => String(e.id).toLowerCase() === backing);
    tiles.push({
      key, cmd, label: t(name), icon: codiconIcon(ctx, icon),
      owner: suya ? label((suya.packageJSON || {}).displayName, suya.id) : 'Visual Studio Code',
      ext: suya ? suya.id : 'vscode',
    });
  }

  // Las pasivas: instaladas desde la tienda pero sin icono en ninguna barra lateral. No
  // se pueden abrir porque no tienen nada que abrir, pero si apagar, y hasta ahora no
  // habia forma de llegar a ellas desde aqui.
  const conIcono = new Set(tiles.map((x) => String(x.ext).toLowerCase()));
  const cargadas = new Set(vscode.extensions.all.map((e) => String(e.id).toLowerCase()));
  const instaladas = installedExtensions(ctx);
  for (const e of instaladas) {
    const id = e.ext.toLowerCase();
    if (conIcono.has(id) || id === 'niko.view-groups') continue;
    conIcono.add(id);
    tiles.push({
      key: 'x:' + e.ext, cmd: null, label: e.label, owner: e.owner, ext: e.ext,
      icon: e.icon, passive: true, off: !cargadas.has(id),
    });
  }

  const seen = new Set();
  const unicas = tiles.filter((x) => !seen.has(x.key) && seen.add(x.key));

  assignGroups(unicas, instaladas, juntadas, separadas);
  return unicas;
}

/**
 * Descarta lo que VS Code no tiene registrado ahora mismo: su comando no existe,
 * asi que pulsarlo no haria absolutamente nada. Es la unica comprobacion fiable,
 * porque las clausulas `when` no se pueden evaluar desde una extension.
 */
async function keepClickable(tiles) {
  let list;
  try {
    list = await vscode.commands.getCommands(true);
  } catch {
    return tiles;                                   // sin lista, mejor mostrarlo todo
  }
  // Una lista vacia o de otro tipo no significa "no hay nada abrible": significa que no
  // se pudo consultar. Filtrar con ella dejaria el tablero en blanco.
  if (!Array.isArray(list) || !list.length) return tiles;
  const known = new Set(list);
  refineChat(tiles, known);
  // Las pasivas no tienen comando que comprobar: se quedan por definicion.
  return tiles.filter((x) => x.passive || known.has(x.cmd));
}

/** Apunta el icono de chat al comando mas concreto que exista aqui. */
function refineChat(tiles, known) {
  const tile = tiles.find((x) => x.key === 'k:chat');
  if (!tile) return tiles;
  for (const re of CHAT_SPECIFIC) {
    const hit = [...known].find((c) => re.test(c));
    if (hit) {
      tile.cmd = hit;
      break;
    }
  }
  return tiles;
}

const PREFIX = 'workbench.view.extension.';
/** Version 0.3: las carpetas guardaban comandos en `cmds`. Se traducen a las claves de ahora. */
const cmdToKey = (c) =>
  c.startsWith(PREFIX) ? 'c:' + c.slice(PREFIX.length) : c.endsWith('.focus') ? 'v:' + c.slice(0, -6) : c;

/** Nunca confiar en el estado guardado: puede venir de otra version o corrupto. */
function normalize(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f) => f && typeof f.name === 'string')
    .map((f) => {
      const src = Array.isArray(f.keys) ? f.keys : Array.isArray(f.cmds) ? f.cmds.map(String).map(cmdToKey) : [];
      const out = { name: f.name, keys: src.filter((k) => typeof k === 'string') };
      if (f.locked) out.locked = true;
      return out;
    });
}

/**
 * El bloque nativo es indestructible: si falta, o si una version vieja lo dejo sin
 * marcar, se reconstruye aqui. Asi no depende de que el estado guardado este bien.
 */
function ensureNative(folders, name) {
  const out = folders.map((f) => ({ ...f }));
  // El bloque es el que ya venia marcado o, en estados de versiones viejas, el que solo
  // contiene nativos. Una carpeta del usuario con un nativo colado NO cuenta como bloque.
  let block = out.find((f) => f.locked)
    || out.find((f) => f.keys.length && f.keys.every((k) => NATIVE_KEYS.includes(k)));
  if (!block) {
    block = { name, keys: [], locked: true };
    out.push(block);
  }
  block.locked = true;
  block.name = block.name || name;
  // Siempre estan todos, y siempre en el orden de la barra de VS Code.
  block.keys = NATIVE_KEYS.slice();
  // Y ningun nativo puede andar suelto en otra carpeta.
  for (const f of out) if (f !== block) f.keys = f.keys.filter((k) => !NATIVE_KEYS.includes(k));
  // Siempre el primero: es el bloque de VS Code y va al tope.
  return [block, ...out.filter((f) => f !== block)];
}

const clone = (folders) => folders.map((f) => (f.locked
  ? { name: f.name, keys: [...f.keys], locked: true }
  : { name: f.name, keys: [...f.keys] }));
const detach = (folders, keys) => {
  for (const f of folders) f.keys = f.keys.filter((k) => !keys.includes(k));
  return folders;
};
/** Inserta `keys` en `list` justo delante de `before` (al final si no esta). */
function insert(list, keys, before) {
  const rest = list.filter((k) => !keys.includes(k));
  const at = before && !keys.includes(before) ? rest.indexOf(before) : -1;
  rest.splice(at < 0 ? rest.length : at, 0, ...keys);
  return rest;
}

class Board {
  constructor(ctx) {
    this.ctx = ctx;
    this.tiles = discover(ctx, this.merged, this.split);
    // Lo que el mercado dijo la ultima vez que se le pregunto. No se guarda entre
    // sesiones: es la foto de una consulta que el usuario pidio, no un hecho del disco.
    this.updates = new Map();
  }

  /**
   * Todo lo que el tablero ha visto alguna vez. Sirve para seguir mostrando, en gris, lo
   * que VS Code ya no carga: da igual si se desactivo desde aqui o desde la vista de
   * extensiones, el resultado que se ve es el mismo porque se mira el hecho, no la intencion.
   */
  get seen() {
    const raw = this.ctx.globalState.get(KEY_SEEN, []);
    return Array.isArray(raw) ? raw.filter((o) => o && typeof o.ext === 'string' && typeof o.key === 'string') : [];
  }

  /** Lo del catalogo que ahora mismo no esta cargado. */
  get off() {
    const present = new Set(vscode.extensions.all.map((e) => String(e.id).toLowerCase()));
    return this.seen.filter((o) => !present.has(o.ext.toLowerCase()));
  }

  get folders() { return ensureNative(normalize(this.ctx.globalState.get(KEY_FOLDERS, [])), t('Native')); }
  get order() { return this.list(KEY_ORDER); }
  get hidden() { return new Set(this.list(KEY_HIDDEN)); }
  get showHidden() { return !!this.ctx.globalState.get(KEY_SHOW_HIDDEN); }
  get names() {
    const raw = this.ctx.globalState.get(KEY_NAMES, {});
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  }
  list(key) {
    const raw = this.ctx.globalState.get(key, []);
    return Array.isArray(raw) ? raw.filter((k) => typeof k === 'string') : [];
  }

  /** El nombre que ve el usuario: el suyo si lo cambio, si no el original. */
  nameOf(tile) {
    const custom = this.names[tile.key];
    return typeof custom === 'string' && custom ? custom : tile.label;
  }

  async save(folders, order) {
    await this.ctx.globalState.update(KEY_FOLDERS, folders);
    if (order) await this.ctx.globalState.update(KEY_ORDER, order);
    this.render();
  }
  /**
   * Relee los manifiestos y descarta lo que no tenga comando registrado. Las extensiones
   * apagadas desaparecen de `vscode.extensions.all`, asi que se vuelven a anadir desde lo
   * guardado: si no, el interruptor se quedaria sin sitio desde donde volver a encenderlas.
   */
  async refresh() {
    const live = await keepClickable(discover(this.ctx, this.merged, this.split));

    // Lo que se acaba de desinstalar sigue cargado hasta recargar la ventana: no se
    // vuelve a anotar, o su icono se quedaria en gris como si solo estuviera apagado.
    const present = new Set(vscode.extensions.all.map((e) => String(e.id).toLowerCase()));
    const removed = this.list(KEY_REMOVED);
    const quedan = removed.filter((id) => present.has(id.toLowerCase()));
    if (quedan.length !== removed.length) await this.ctx.globalState.update(KEY_REMOVED, quedan);
    const ignorar = new Set(quedan.map((id) => id.toLowerCase()));

    // El catalogo se pone al dia con lo que hay cargado ahora.
    const catalogo = new Map(this.seen.map((o) => [o.key, o]));
    for (const x of live) {
      if (x.ext === 'vscode' || x.passive) continue;          // los de fabrica no se apagan
      if (ignorar.has(String(x.ext).toLowerCase())) continue;
      catalogo.set(x.key, {
        ext: x.ext, key: x.key, cmd: x.cmd, label: x.label, owner: x.owner,
        iconPath: x.icon ? x.icon.uri.fsPath : null, mask: !!(x.icon && x.icon.mask),
      });
    }
    await this.ctx.globalState.update(KEY_SEEN, [...catalogo.values()]);
    // Version 1.11 y anteriores guardaban una lista a la espera; ya no existe.
    if (this.ctx.globalState.get(KEY_QUEUE)) await this.ctx.globalState.update(KEY_QUEUE, undefined);
    if (this.ctx.globalState.get(KEY_OFF)) {
      // Version anterior: marcaba apagadas por intencion, no por hecho. Se descarta.
      await this.ctx.globalState.update(KEY_OFF, undefined);
    }

    const vistos = new Set(live.map((x) => x.key));
    const dormidas = this.off
      .filter((o) => !vistos.has(o.key))
      .map((o) => ({
        key: o.key, cmd: o.cmd, label: o.label, owner: o.owner, ext: o.ext, off: true,
        icon: o.iconPath ? { uri: vscode.Uri.file(o.iconPath), mask: !!o.mask } : null,
      }));
    this.tiles = [...live, ...dormidas];
    // Con las apagadas ya dentro, para que entren en la misma familia que las demas.
    assignGroups(this.tiles, installedExtensions(this.ctx), this.merged, this.split);
    this.render();
  }


  /**
   * Lleva a la ficha de la extension en la vista de Extensiones. Es el unico sitio donde
   * los botones de habilitar y deshabilitar funcionan de verdad.
   */
  async openExtensionPage(extId, motivo) {
    for (const cmd of EXT_PAGE_CMDS) {
      try {
        await vscode.commands.executeCommand(cmd, cmd === 'extension.open' ? extId : '@id:' + extId);
        break;
      } catch { /* se prueba el siguiente */ }
    }
    if (motivo) vscode.window.showInformationMessage(motivo);
  }

  /**
   * Desinstala la extension. A diferencia de desactivar, esto si se puede hacer por
   * codigo — y por eso mismo se confirma antes: lo que se borra hay que volver a bajarlo.
   */
  async uninstall(key) {
    const tile = this.tiles.find((x) => x.key === key);
    if (!tile || tile.native || !tile.ext || tile.ext === 'vscode') return;
    const yes = t('Uninstall');
    const pick = await vscode.window.showWarningMessage(
      t('Uninstall "{0}"? It is deleted from disk: to get it back you have to download it again.', this.nameOf(tile)),
      { modal: true }, yes
    );
    if (pick !== yes) return;
    let ok = false;
    for (const cmd of UNINSTALL_CMDS) {
      try {
        await vscode.commands.executeCommand(cmd, tile.ext);
        ok = true;
        break;
      } catch (e) {
        console.error('[GG Groups] no se pudo desinstalar con', cmd, e);
      }
    }
    if (!ok) {
      await this.openExtensionPage(tile.ext, t('Use the Uninstall button on this page.'));
      return;
    }
    // Desinstalada no es apagada: su icono no debe quedarse en gris esperando volver.
    await this.ctx.globalState.update(KEY_SEEN, this.seen.filter((o) => o.ext !== tile.ext));
    await this.ctx.globalState.update(KEY_REMOVED, [...this.list(KEY_REMOVED), tile.ext]);
    await this.refresh();
  }

  /**
   * Respaldo para cuando no hay Python: deja en el portapapeles la orden equivalente,
   * para ejecutarla a mano con VS Code cerrado.
   */
  async copyScript(cambios) {
    if (!cambios.length) return;
    const guion = vscode.Uri.joinPath(this.ctx.extensionUri, 'scripts', 'gg-extensions.py').fsPath;
    const linea = (accion) => {
      const ids = cambios.filter((o) => o.action === accion).map((o) => o.ext);
      return ids.length ? `python "${guion}" ${accion} ${ids.join(' ')}` : null;
    };
    const orden = [linea('disable'), linea('enable')].filter(Boolean).join('\n');
    try {
      await vscode.env.clipboard.writeText(orden);
    } catch { /* sin portapapeles, al menos se ve en el aviso */ }
    vscode.window.showInformationMessage(t('Copied. Close VS Code, run it in a terminal, and open it again:'), {
      modal: false, detail: orden,
    });
  }

  /**
   * Lo que hay que cambiar de verdad, a partir de lo que se pidio. Se descartan los que
   * ya estan como se quiere y los que no se pueden tocar: pedir apagar algo ya apagado
   * cerraria el editor para no hacer nada.
   */
  changesFor(keys, action) {
    const fuera = [];
    const vistos = new Set();
    for (const key of Array.isArray(keys) ? keys : []) {
      const tile = this.tiles.find((x) => x.key === key);
      if (!tile || tile.native || !tile.ext || tile.ext === 'vscode') continue;
      if (action === 'disable' ? tile.off : !tile.off) continue;
      if (vistos.has(tile.ext)) continue;         // una extension con dos iconos, un cambio
      vistos.add(tile.ext);
      fuera.push({ key, ext: tile.ext, action, label: this.nameOf(tile) });
    }
    return fuera;
  }

  /**
   * Apaga o enciende lo pedido, del tiron. Un solo cierre para todos los cambios, en vez
   * de uno por extension: se lanza un proceso aparte que espera a que VS Code se cierre,
   * escribe y lo vuelve a abrir. Recargar la ventana no valdria — el proceso principal de
   * VS Code sigue vivo con esa base en memoria y la vuelca al salir, pisando lo escrito.
   */
  async applyChanges(keys, action) {
    const cambios = this.changesFor(keys, action);
    if (!cambios.length) return;

    const python = await findPython();
    if (!python) {
      vscode.window.showWarningMessage(t('Python is needed for this. Copying the command instead.'));
      return this.copyScript(cambios);
    }

    const si = t('Close and apply');
    const detalle = cambios.map((o) => (o.action === 'disable' ? '- ' : '+ ') + o.label).join('\n');
    const pick = await vscode.window.showWarningMessage(
      t('Apply {0} changes? VS Code closes, applies them and opens again.', cambios.length),
      { modal: true, detail: detalle + '\n\n' + t('A window will open. Do not open VS Code yourself: it opens it for you when it finishes.') },
      si
    );
    if (pick !== si) return;

    const plan = restartCommand({
      dir: vscode.Uri.joinPath(this.ctx.extensionUri, 'scripts').fsPath.replace(/\\/g, '/'),
      python,
      disable: cambios.filter((o) => o.action === 'disable').map((o) => o.ext),
      enable: cambios.filter((o) => o.action === 'enable').map((o) => o.ext),
      codeExe: process.execPath,
      log: this.logPath(),
    });
    try {
      await vscode.workspace.fs.createDirectory(this.ctx.globalStorageUri);
    } catch { /* si ya existe, mejor */ }
    try {
      const hijo = spawn(plan.exe, plan.args,
        { detached: true, stdio: 'ignore', windowsHide: false, env: plan.env });
      hijo.unref();
    } catch (e) {
      vscode.window.showErrorMessage(t('Could not apply the list: {0}', (e && e.message) || String(e)));
      return;
    }
    // Un instante para que el proceso quede en marcha antes de cerrar el editor.
    await new Promise((r) => setTimeout(r, 600));
    await vscode.commands.executeCommand('workbench.action.quit');
  }

  /** Desinstala varias de una vez, con una sola confirmacion que las enumera todas. */
  async uninstallMany(keys) {
    const tiles = (Array.isArray(keys) ? keys : [])
      .map((k) => this.tiles.find((x) => x.key === k))
      .filter((t) => t && !t.native && t.ext && t.ext !== 'vscode');
    if (!tiles.length) return;
    if (tiles.length === 1) return this.uninstall(tiles[0].key);

    // Por extension, no por baldosa: una extension con dos iconos se desinstala una vez.
    const exts = [...new Set(tiles.map((t) => t.ext))];
    const yes = t('Uninstall');
    const pick = await vscode.window.showWarningMessage(
      t('Uninstall {0} extensions? They are deleted from disk.', exts.length),
      { modal: true, detail: tiles.map((x) => this.nameOf(x)).join('\n') }, yes
    );
    if (pick !== yes) return;
    for (const ext of exts) {
      for (const cmd of UNINSTALL_CMDS) {
        try {
          await vscode.commands.executeCommand(cmd, ext);
          break;
        } catch (e) {
          console.error('[GG Groups] no se pudo desinstalar', ext, e);
        }
      }
      await this.ctx.globalState.update(KEY_SEEN, this.seen.filter((o) => o.ext !== ext));
      await this.ctx.globalState.update(KEY_REMOVED, [...this.list(KEY_REMOVED), ext]);
    }
    await this.refresh();
  }

  /**
   * Pregunta al mercado que extensiones tienen version nueva. Solo se hace cuando el
   * usuario lo pide: hasta entonces GG Groups no habla con nadie de fuera.
   */
  async checkUpdates() {
    const instaladas = new Map(
      installedExtensions(this.ctx).map((o) => [o.ext.toLowerCase(), o.version]));
    if (!instaladas.size) {
      vscode.window.showInformationMessage(t('No installed extensions to check.'));
      return;
    }
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: t('Asking the marketplace...') },
      async () => {
        try {
          this.updates = await fetchUpdates([...instaladas.keys()], instaladas);
        } catch (e) {
          vscode.window.showWarningMessage(
            t('Could not ask the marketplace: {0}', (e && e.message) || String(e)));
          return;
        }
        this.render();
        vscode.window.showInformationMessage(this.updates.size
          ? t('{0} with a new version. Right-click to update.', this.updates.size)
          : t('Everything is up to date.'));
      });
  }

  /** Instala la ultima version de una extension. VS Code se encarga del resto. */
  async update(key) {
    const tile = this.tiles.find((x) => x.key === key);
    if (!tile || !tile.ext || tile.ext === 'vscode') return;
    for (const cmd of INSTALL_CMDS) {
      try {
        await vscode.commands.executeCommand(cmd, tile.ext);
        this.updates.delete(tile.ext.toLowerCase());
        this.render();
        return;
      } catch (e) {
        console.error('[GG Groups] no se pudo actualizar con', cmd, e);
      }
    }
    // Si ningun comando responde, al menos se llega a su ficha, donde el boton si esta.
    await this.openExtensionPage(tile.ext, t('Use the Update button on this page.'));
  }

  /** Donde el proceso de fuera deja constancia de lo que hizo. */
  logPath() {
    return vscode.Uri.joinPath(this.ctx.globalStorageUri, 'gg-apply.log').fsPath.replace(/\\/g, '/');
  }

  /**
   * Cuenta como fue el ultimo intento. Sin esto, si algo falla ahi fuera, desde VS Code
   * no hay manera de enterarse: fue justo lo que paso la primera vez que se probo.
   */
  async lastRunReport() {
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(this.logPath()));
      return Buffer.from(bytes).toString('utf8').trim().split(/\r?\n/).slice(-12).join('\n');
    } catch {
      return null;
    }
  }

  /** Parejas que el usuario junto a mano arrastrando un icono sobre otro. */
  get merged() {
    const raw = this.ctx.globalState.get(KEY_MERGED, []);
    return Array.isArray(raw) ? raw.filter((p) => Array.isArray(p) && p.length === 2) : [];
  }

  /** Extensiones que el usuario saco de su familia: mandan sobre el paquete y el dibujo. */
  get split() {
    return this.list(KEY_SPLIT);
  }

  /** Junta dos iconos en uno: la familia de uno pasa a ser la del otro. */
  async mergeTiles(keys, target) {
    const destino = this.tiles.find((x) => x.key === target);
    if (!destino || !destino.ext || destino.ext === 'vscode' || destino.native) return;
    const exts = (Array.isArray(keys) ? keys : [])
      .map((k) => this.tiles.find((x) => x.key === k))
      .filter((x) => x && x.ext && x.ext !== 'vscode' && !x.native && x.ext !== destino.ext)
      .map((x) => x.ext);
    if (!exts.length) return;
    // Juntarlas deshace el "sepáralas" de antes: la ultima intencion es la que vale.
    const sueltas = new Set([destino.ext, ...exts].map((e) => e.toLowerCase()));
    await this.ctx.globalState.update(KEY_SPLIT, this.split.filter((e) => !sueltas.has(String(e).toLowerCase())));
    await this.ctx.globalState.update(KEY_MERGED,
      [...this.merged, ...[...new Set(exts)].map((e) => [e, destino.ext])]);
    await this.refresh();
  }

  /** Saca de su familia lo que se le pase: cada extension vuelve a tener su icono. */
  async splitTiles(keys) {
    const exts = [...new Set((Array.isArray(keys) ? keys : [])
      .map((k) => this.tiles.find((x) => x.key === k))
      .filter((x) => x && x.ext && x.ext !== 'vscode' && !x.native)
      .map((x) => x.ext))];
    if (exts.length < 2) return;                 // separar una sola no la separa de nada
    const bajas = new Set(exts.map((e) => e.toLowerCase()));
    await this.ctx.globalState.update(KEY_MERGED,
      this.merged.filter(([a, b]) => !bajas.has(String(a).toLowerCase()) && !bajas.has(String(b).toLowerCase())));
    await this.ctx.globalState.update(KEY_SPLIT, [...new Set([...this.split, ...exts])]);
    await this.ctx.globalState.update(KEY_FACE, this.faces.filter((e) => !bajas.has(String(e).toLowerCase())));
    await this.refresh();
  }

  /** Iconos que el usuario eligio como cara de su grupo. */
  get faces() {
    return this.list(KEY_FACE);
  }

  /** Pregunta cual de las del grupo pone la cara, y se queda con esa. */
  async pickFace(keys) {
    const tiles = (Array.isArray(keys) ? keys : [])
      .map((k) => this.tiles.find((x) => x.key === k))
      .filter((x) => x && x.ext && x.ext !== 'vscode' && !x.native);
    if (tiles.length < 2) return;
    const opciones = [];
    const vistos = new Set();
    for (const x of tiles) {
      if (vistos.has(x.ext)) continue;                  // una entrada por extension
      vistos.add(x.ext);
      opciones.push({ label: this.nameOf(x), description: x.ext, ext: x.ext });
    }
    const pick = await vscode.window.showQuickPick(opciones, { title: t('Which icon represents the group?') });
    if (!pick) return;
    // Una sola cara por grupo: las demas del mismo dejan de serlo.
    const suyas = new Set(tiles.map((x) => String(x.ext).toLowerCase()));
    await this.ctx.globalState.update(KEY_FACE,
      [...this.faces.filter((e) => !suyas.has(String(e).toLowerCase())), pick.ext]);
    this.render();
  }

  /** Deja de recordar una extension apagada: su icono desaparece del tablero. */
  async forget(key) {
    const quedan = this.seen.filter((o) => o.key !== key);
    if (quedan.length === this.seen.length) return;
    await this.ctx.globalState.update(KEY_SEEN, quedan);
    await this.refresh();
  }


  /**
   * Comprueba de verdad lo que la extension necesita para funcionar y devuelve la lista
   * de problemas encontrados. Escribe el detalle en el canal de salida que se le pase.
   */
  async selfTest(out) {
    const fallos = [];
    const say = (linea) => out && out.appendLine(linea);

    say('idioma: ' + (this.ctx.globalState.get(KEY_LOCALE) || systemLocale()) +
        '  |  VS Code: ' + vscode.version + '  |  ' + process.platform);

    // 1. Baldosas y sus iconos.
    say('');
    say('baldosas: ' + this.tiles.length);
    let sinIcono = 0;
    for (const x of this.tiles) {
      let estado = 'sin icono (sale la inicial)';
      if (x.icon) {
        const existe = (() => { try { return fs.existsSync(x.icon.uri.fsPath); } catch { return false; } })();
        estado = existe ? (x.icon.mask ? 'icono monocromo' : 'icono') : 'ICONO PERDIDO: ' + x.icon.uri.fsPath;
        if (!existe) fallos.push(x.label + ': su icono no esta en el disco');
      } else {
        sinIcono++;
      }
      say('  ' + (x.off ? '[apagada] ' : '') + x.label + '  ·  ' + estado);
    }
    if (sinIcono) say('  (' + sinIcono + ' sin icono propio: es normal, salen con su inicial)');

    // 2. Comandos: que lo que se muestra se pueda abrir.
    say('');
    let known = null;
    try {
      const lista = await vscode.commands.getCommands(true);
      if (Array.isArray(lista) && lista.length) known = new Set(lista);
    } catch { /* nada */ }
    if (!known) {
      fallos.push('no se pudo consultar la lista de comandos de VS Code');
      say('comandos: no se pudo consultar');
    } else {
      const muertos = this.tiles.filter((x) => !x.off && !known.has(x.cmd));
      say('comandos: ' + (muertos.length ? muertos.length + ' sin registrar' : 'todos responden'));
      for (const x of muertos) fallos.push(x.label + ': su comando no existe (' + x.cmd + ')');
    }

    // 3. Capacidades: se informan, no son fallos.
    say('');
    say('python: ' + (await findPython() || 'no encontrado (habria que aplicar la lista a mano)'));
    say('apagadas ahora mismo: ' + (this.off.map((o) => o.label).join(', ') || 'ninguna'));
    // El intento anterior ocurre fuera de VS Code: sin esto, un fallo alli no se ve desde aqui.
    const ultimo = await this.lastRunReport();
    say('ultimo intento de aplicar: ' + (ultimo ? '\n' + ultimo : 'ninguno todavia'));
    say('mover a la barra derecha: ' + ((await this.moveCommands()).filter((c) => MOVE_RIGHT.test(c))[0]
      || 'no disponible (hay que arrastrar el icono)'));

    // 4. Estado guardado coherente.
    say('');
    const folders = this.folders;
    const bloque = folders.filter((f) => f.locked);
    if (bloque.length !== 1) fallos.push('el bloque nativo deberia ser exactamente uno, hay ' + bloque.length);
    else if (folders[0] !== bloque[0]) fallos.push('el bloque nativo no esta arriba del todo');
    else if (bloque[0].keys.join() !== NATIVE_KEYS.join()) fallos.push('el bloque nativo no tiene el orden de VS Code');
    const repetidas = folders.flatMap((f) => f.keys).filter((k, i, a) => a.indexOf(k) !== i);
    if (repetidas.length) fallos.push('hay iconos en dos carpetas a la vez: ' + repetidas.join(', '));
    say('carpetas: ' + folders.length + '  |  ocultos: ' + this.hidden.size + '  |  apagados: ' + this.off.length);

    return fallos;
  }

  /** La carpeta "Nativo" se siembra una sola vez, al final; despues es tuya. */
  async seed() {
    if (this.ctx.globalState.get(KEY_SEEDED)) return;
    await this.ctx.globalState.update(KEY_SEEDED, true);
    await this.save(clone(this.folders));       // ensureNative lo deja en su sitio
  }

  /**
   * Lleva el tablero entero a la barra lateral derecha. Se hace en dos pasos porque
   * los comandos de VS Code actuan sobre la vista que tiene el foco: primero se enfoca
   * la nuestra, se le deja un respiro al workbench, y luego se manda mover.
   * Devuelve true si se pudo; false si esta version de VS Code no trae el comando.
   */
  /** Todos los comandos de mover vistas que expone esta version de VS Code. */
  async moveCommands() {
    try {
      return (await vscode.commands.getCommands(true)).filter((c) => /move.*view/i.test(c));
    } catch {
      return [];
    }
  }

  async dockRight() {
    const all = await this.moveCommands();
    const targets = all.filter((c) => MOVE_RIGHT.test(c));
    if (!targets.length) targets.push('workbench.action.moveFocusedViewToSecondarySideBar');
    for (const cmd of targets) {
      try {
        await vscode.commands.executeCommand('viewGroups.board.focus');
        await new Promise((r) => setTimeout(r, FOCUS_DELAY));
        await vscode.commands.executeCommand(cmd);
        return true;
      } catch (e) {
        console.error('[GG Groups] fallo al mover con', cmd, e);
      }
    }
    console.error('[GG Groups] comandos de mover disponibles:', all);
    return false;
  }

  /** La primera vez el tablero se ancla solo a la barra derecha, para no taparse. */
  async autoDock() {
    if (this.ctx.globalState.get(KEY_DOCKED)) return;
    await this.ctx.globalState.update(KEY_DOCKED, true);
    // En el arranque no se molesta al usuario: si no se puede, queda donde esta.
    await this.dockRight();
  }

  byName(a, b) {
    const x = this.tiles.find((y) => y.key === a), y = this.tiles.find((z) => z.key === b);
    return (x ? this.nameOf(x) : a).localeCompare(y ? this.nameOf(y) : b);
  }

  /**
   * Las apagadas se van al final, sin sacarlas de su sitio ni ponerlas en otra seccion,
   * y entre ellas siempre alfabeticas: el orden manual solo manda entre las encendidas.
   */
  offLast(list) {
    const alfabetico = (a, b) => this.nameOf(a).localeCompare(this.nameOf(b));
    // Primero lo que tiene icono propio, luego lo apagado, y al final las pasivas, que
    // son muchas y no deben empujar hacia abajo lo que se usa a diario.
    const on = list.filter((x) => !x.off && !x.passive);
    const off = list.filter((x) => x.off && !x.passive).sort(alfabetico);
    const pasivas = list.filter((x) => x.passive).sort(alfabetico);
    return [...on, ...off, ...pasivas];
  }

  /** Las baldosas visibles ahora mismo, sin las que viven en carpetas, ya ordenadas. */
  looseTiles(folders) {
    const taken = new Set((folders || this.folders).flatMap((f) => f.keys));
    const rank = new Map(this.order.map((k, i) => [k, i]));
    const at = (k) => (rank.has(k) ? rank.get(k) : 1e9);
    // Sin orden guardado quedan alfabeticas, que es como deben salir de fabrica.
    return this.offLast(this.visible()
      .filter((x) => !taken.has(x.key))
      .sort((a, b) => at(a.key) - at(b.key) || this.nameOf(a).localeCompare(this.nameOf(b))));
  }

  /** Todo menos lo que el usuario mando a ocultar (salvo que pida verlo). */
  visible() {
    const hidden = this.hidden;
    // Las pasivas viven con los ocultos: el tablero es la barra lateral, y ahi no estan.
    // Se asoman al abrir el ojo, que es cuando se esta revisando lo que no se ve.
    if (this.showHidden) return this.tiles;
    return this.tiles.filter((x) => !x.passive && !hidden.has(x.key));
  }

  uniqueName(base, folders) {
    let name = base, n = 2;
    while (folders.some((f) => f.name === name)) name = `${base} ${n++}`;
    return name;
  }
  /** Pide un nombre libre; null si el usuario cancela o ya existe. */
  async askName(folders, value) {
    const name = ((await vscode.window.showInputBox({ prompt: t('Folder name'), value })) || '').trim();
    if (!name) return null;
    if (folders.some((f) => f.name === name)) {
      vscode.window.showErrorMessage(t('A folder named "{0}" already exists.', name));
      return null;
    }
    return name;
  }

  // --- vista de la barra lateral ---
  resolveWebviewView(view) {
    this.panel = view;
    view.title = t('My extensions');
    view.webview.options = { enableScripts: true, localResourceRoots: this.roots() };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((m) => this.onMessage(m));
    // Solo soltar la referencia si la que muere es esta: al recrear la vista, VS Code
    // puede desechar la anterior DESPUES de resolver la nueva y dejarnos sin panel.
    view.onDidDispose(() => { if (this.panel === view) this.panel = null; });
    // Al volver de otro contenedor se repinta, por si el contenido quedo obsoleto.
    if (view.onDidChangeVisibility) view.onDidChangeVisibility(() => { if (view.visible) this.render(); });
    this.render();
    this.autoDock();
  }

  roots() {
    const list = [this.ctx.extensionUri];
    for (const e of vscode.extensions.all) if (e.extensionUri) list.push(e.extensionUri);
    // Una extension apagada ya no esta en extensions.all, asi que su carpeta se quedaba
    // fuera de los permisos del webview: el archivo del logo no cargaba y el icono caia
    // a la inicial. El catalogo si recuerda donde estaba, y de ahi sale el permiso.
    for (const o of this.seen) {
      if (o.iconPath) list.push(vscode.Uri.joinPath(vscode.Uri.file(o.iconPath), '..'));
    }
    return list;
  }

  /**
   * Reparte las baldosas en grupos de icono igual y decide donde vive cada grupo. Manda
   * la mas viva de sus baldosas: si de los tres iconos de una extension queda uno activo,
   * el grupo entero se pinta donde ese, no escondido con los demas.
   */
  layout() {
    const folders = this.folders;
    const hidden = this.hidden;
    // Una pasiva esta cargada; una apagada no. Asi que entre las dos manda la pasiva, y
    // una familia con seis pasivas y una apagada no se va entera a Desactivadas.
    const rango = (x) => (x.off ? 3 : x.passive ? 2 : hidden.has(x.key) ? 1 : 0);

    const grupos = new Map();
    for (const x of this.visible()) {
      if (x.native) continue;
      const k = x.group || 'key:' + x.key;
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(x);
    }

    const enCarpeta = new Map();
    const posicion = new Map();
    for (const f of folders) {
      if (f.locked) continue;
      f.keys.forEach((k, i) => { enCarpeta.set(k, f.name); posicion.set(k, i); });
    }

    const fuera = { folders: new Map(), loose: [], passive: [], off: [] };
    for (const f of folders) if (!f.locked) fuera.folders.set(f.name, []);

    // Entre las igual de vivas manda el orden que el usuario les dio: la que arrastro
    // delante es la que da la cara por la familia.
    const orden = new Map(this.order.map((k, i) => [k, i]));
    const suOrden = (x) => (orden.has(x.key) ? orden.get(x.key) : posicion.has(x.key) ? posicion.get(x.key) : 1e9);
    // Dos cosas distintas: quien decide DONDE vive el grupo —la baldosa mas viva— y quien
    // le pone la CARA. La cara puede ser una pasiva; colocar por ella escondería el grupo.
    const elegida = new Set(this.faces.map((e) => String(e).toLowerCase()));
    const comoCara = (x) => (elegida.has(String(x.ext).toLowerCase()) ? 0 : 1);
    for (const tiles of grupos.values()) {
      const lider = [...tiles].sort((a, b) => rango(a) - rango(b) || suOrden(a) - suOrden(b))[0];
      const lista = [...tiles].sort((a, b) =>
        comoCara(a) - comoCara(b)                       // lo que el usuario haya elegido
        || (b.brought || 0) - (a.brought || 0)          // la que trajo a las demas
        || (a.installed || 0) - (b.installed || 0)      // y entre iguales, la mas antigua
        || suOrden(a) - suOrden(b));
      const grupo = { lider, tiles: lista };
      const r = rango(grupo.lider);
      if (r === 3) fuera.off.push(grupo);
      else if (r === 2) fuera.passive.push(grupo);
      else {
        const carpeta = enCarpeta.get(grupo.lider.key);
        if (carpeta && fuera.folders.has(carpeta)) fuera.folders.get(carpeta).push(grupo);
        else fuera.loose.push(grupo);
      }
    }

    const alfabetico = (a, b) => this.nameOf(a.lider).localeCompare(this.nameOf(b.lider));
    // El sitio de una familia es el de la baldosa suya que este mas arriba: arrastrar
    // cualquiera de sus iconos coloca al grupo entero, que es lo que se espera.
    const porOrden = (mapa) => (a, b) => {
      const at = (g) => Math.min(...g.tiles.map((x) => (mapa.has(x.key) ? mapa.get(x.key) : 1e9)));
      return at(a) - at(b) || alfabetico(a, b);
    };
    fuera.loose.sort(porOrden(orden));
    for (const lista of fuera.folders.values()) lista.sort(porOrden(posicion));
    fuera.passive.sort(alfabetico);
    fuera.off.sort(alfabetico);
    return fuera;
  }

  render() {
    if (!this.panel) return;
    const w = this.panel.webview;
    const folders = this.folders;
    const byKey = new Map(this.visible().map((x) => [x.key, x]));
    const hidden = this.hidden;
    const names = this.names;
    const pack = (x) => ({
      key: x.key, label: this.nameOf(x), owner: x.owner,
      icon: x.icon ? String(w.asWebviewUri(x.icon.uri)) : null,
      mask: !!(x.icon && x.icon.mask),
      off: !!x.off,
      fixed: !!x.native || x.ext === 'vscode',
      passive: !!x.passive,
      group: x.group || 'key:' + x.key,
      update: this.updates.get(String(x.ext).toLowerCase()) || null,
      hidden: hidden.has(x.key),
      renamed: typeof names[x.key] === 'string',
    });
    const reparto = this.layout();
    const aplanar = (grupos) => grupos.flatMap((g) => g.tiles).map(pack);
    const secciones = [];
    // Al final del todo, y solo si tienen algo que enseñar.
    if (reparto.passive.length) {
      secciones.push({ name: t('Passive extensions'), section: true, tiles: aplanar(reparto.passive) });
    }
    if (reparto.off.length) {
      secciones.push({ name: t('Disabled'), section: true, tiles: aplanar(reparto.off) });
    }

    w.postMessage({
      type: 'state',
      showHidden: this.showHidden,
      hiddenCount: hidden.size,
      folders: folders.map((f) => ({
        name: f.name,
        locked: !!f.locked,
        // El bloque nativo se pinta siempre en el orden de la barra de VS Code.
        tiles: f.locked
          ? NATIVE_KEYS.filter((k) => f.keys.includes(k)).map((k) => byKey.get(k)).filter(Boolean).map(pack)
          : aplanar(reparto.folders.get(f.name) || []),
      })),
      loose: aplanar(reparto.loose),
      sections: secciones,
    });
  }

  /** Ejecuta el comando de la baldosa sin quedarse colgado si nunca responde. */
  async open(key) {
    const tile = this.tiles.find((x) => x.key === key);
    if (!tile) return;
    // Pasiva: no aporta panel ninguno, asi que se abre su ficha en la tienda.
    if (tile.passive && !tile.off) return this.openExtensionPage(tile.ext);
    // Apagada: no hay panel que abrir. Se dice, y encenderla es una accion aparte y
    // deliberada — no algo que ocurra por pulsar donde antes se abria otra cosa.
    if (tile.off) {
      vscode.window.showInformationMessage(
        modKey(t('"{0}" is turned off. Pick it with Ctrl+click and press play to turn it on.', this.nameOf(tile))));
      return;
    }
    let timer;
    try {
      await Promise.race([
        Promise.resolve(vscode.commands.executeCommand(tile.cmd)),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(t('it did not respond'))), OPEN_TIMEOUT); }),
      ]);
    } catch (e) {
      vscode.window.showErrorMessage(t('Could not open "{0}": {1}', this.nameOf(tile), (e && e.message) || String(e)));
    } finally {
      clearTimeout(timer);
    }
  }

  async setHidden(keys, hide) {
    const set = this.hidden;
    for (const k of keys) hide ? set.add(k) : set.delete(k);
    await this.ctx.globalState.update(KEY_HIDDEN, [...set]);
    this.render();
  }

  /** La carpeta de los iconos nativos esta bloqueada: ni se reordena ni se saca nada de ella. */
  isLocked(key) {
    return this.folders.some((f) => f.locked && f.keys.includes(key));
  }
  lockedFolder(name) {
    return this.folders.some((f) => f.locked && f.name === name);
  }

  async onMessage(m) {
    if (!m || typeof m.type !== 'string') return;
    // El webview es codigo aparte: se valida lo que manda antes de tocar el estado.
    m = { ...m, keys: (Array.isArray(m.keys) ? m.keys : []).filter((k) => typeof k === 'string') };
    // Nada que salga, entre o reordene el bloque nativo.
    const TOUCHES = ['group', 'move', 'moveTo', 'ungroup', 'hide'];
    if (TOUCHES.includes(m.type)) {
      if (m.keys.some((k) => this.isLocked(k))) return;
      if (typeof m.target === 'string' && this.isLocked(m.target)) return;
      if (typeof m.before === 'string' && this.isLocked(m.before)) return;
      if (typeof m.folder === 'string' && this.lockedFolder(m.folder)) return;
    }
    if (['sort', 'rename', 'delete', 'reorder'].includes(m.type) && this.lockedFolder(m.folder)) return;
    const folders = clone(this.folders);
    switch (m.type) {
      case 'open':
        return this.open(m.key);

      // Soltar encima de otra baldosa: crea carpeta, o entra en la del destino.
      case 'merge':
        return this.mergeTiles(m.keys, m.target);
      case 'split':
        return this.splitTiles(m.keys);
      case 'face':
        return this.pickFace(m.keys);
      case 'group': {
        const keys = m.keys.filter((k) => k !== m.target);
        if (!keys.length || !this.tiles.some((x) => x.key === m.target)) return;
        let dest = folders.find((f) => f.keys.includes(m.target));
        if (!dest) {
          const name = await this.askName(folders, this.uniqueName(t('New group'), folders));
          if (!name) return;
          dest = { name, keys: [m.target] };
          folders.unshift(dest);
        }
        detach(folders, keys);
        dest.keys.push(...keys);
        return this.save(folders);
      }

      // Soltar entre dos baldosas: reordena, igual que la barra lateral de VS Code.
      case 'move': {
        if (!m.keys.length) return;
        const before = typeof m.before === 'string' ? m.before : null;
        const dest = before ? folders.find((f) => f.keys.includes(before)) : null;
        detach(folders, m.keys);
        if (dest) {
          dest.keys = insert(dest.keys, m.keys, before);
          return this.save(folders);
        }
        const loose = this.looseTiles(folders).map((x) => x.key);
        return this.save(folders, insert(loose, m.keys, before));
      }

      case 'moveTo': {
        const dest = folders.find((f) => f.name === m.folder);
        if (!dest) return;
        const keys = m.keys.filter((k) => !dest.keys.includes(k));
        detach(folders, keys);
        dest.keys.push(...keys);
        return this.save(folders);
      }

      case 'ungroup': {
        if (!m.keys.length) return;
        detach(folders, m.keys);
        const loose = this.looseTiles(folders).map((x) => x.key);
        return this.save(folders, insert(loose, m.keys, null));
      }

      // Ordenar alfabeticamente: una carpeta concreta, o todo lo que esta suelto.
      case 'sort': {
        if (typeof m.folder === 'string') {
          const f = folders.find((x) => x.name === m.folder);
          if (!f) return;
          f.keys.sort((a, b) => this.byName(a, b));
          return this.save(folders);
        }
        return this.save(folders, []);              // sin orden propio = alfabetico
      }

      case 'reorder': {
        const moving = folders.filter((f) => f.name === m.folder);
        // Nada se coloca por encima del bloque nativo.
        if (!moving.length || m.folder === m.before || this.lockedFolder(m.before)) return;
        const rest = folders.filter((f) => f.name !== m.folder);
        const at = rest.findIndex((f) => f.name === m.before);
        rest.splice(at < 0 ? rest.length : at, 0, ...moving);
        return this.save(rest);
      }

      case 'rename': {
        const f = folders.find((x) => x.name === m.folder);
        if (!f) return;
        const name = await this.askName(folders.filter((x) => x.name !== m.folder), m.folder);
        if (!name) return;
        f.name = name;
        return this.save(folders);
      }

      // Renombrar un icono. Como los repetidos se apilan por nombre, cambiarlo
      // tambien sirve para sacar uno de la pila.
      case 'renameTile': {
        const tile = this.tiles.find((x) => x.key === m.key);
        if (!tile) return;
        const value = ((await vscode.window.showInputBox({
          prompt: t('Icon name'), value: this.nameOf(tile),
        })) || '').trim();
        if (!value) return;
        const names = { ...this.names, [m.key]: value };
        await this.ctx.globalState.update(KEY_NAMES, names);
        return this.render();
      }

      case 'resetName': {
        const names = { ...this.names };
        if (!(m.key in names)) return;
        delete names[m.key];
        await this.ctx.globalState.update(KEY_NAMES, names);
        return this.render();
      }

      case 'hide':
        return this.setHidden(m.keys, true);
      case 'unhide':
        return this.setHidden(m.keys, false);
      case 'apply':
        return this.applyChanges(m.keys, m.action === 'enable' ? 'enable' : 'disable');
      case 'uninstallMany':
        return this.uninstallMany(m.keys);
      case 'forget':
        return this.forget(m.key);
      case 'uninstall':
        return this.uninstall(m.key);
      case 'unhideAll':
        await this.ctx.globalState.update(KEY_HIDDEN, []);
        return this.render();
      case 'toggleHidden':
        await this.ctx.globalState.update(KEY_SHOW_HIDDEN, !this.showHidden);
        return this.render();

      case 'delete':
        if (!folders.some((f) => f.name === m.folder)) return;
        return this.save(folders.filter((f) => f.name !== m.folder));

      case 'newFolder':
        return this.newFolder();
      // El webview avisa de que ya esta en marcha: hasta aqui no habia nadie escuchando.
      case 'checkUpdates':
        return this.checkUpdates();
      case 'update':
        return this.update(m.key);
      case 'ready':
        return this.tiles.length ? this.render() : this.refresh();
      case 'refresh':
        return this.refresh();
    }
  }

  async newFolder() {
    const folders = clone(this.folders);
    const name = await this.askName(folders, this.uniqueName(t('New group'), folders));
    if (!name) return;
    folders.unshift({ name, keys: [] });
    await this.save(folders);
  }

  html(w) {
    const nonce = String(Math.random()).slice(2);
    const uri = (f) => w.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'media', f));
    // Los botones del pie usan los codicons oficiales, como cualquier icono de la barra.
    const icons = {};
    for (const n of ['new-folder', 'list-ordered', 'eye', 'eye-closed', 'debug-pause',
                     'play', 'trash', 'check-all', 'refresh']) {
      icons[n] = String(w.asWebviewUri(
        vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'codicons', n + '.svg')));
    }
    // En Mac, Ctrl+clic ES el clic derecho: alli la tecla de "y ademas este" es Cmd, y el
    // codigo ya acepta las dos. Solo faltaba que el texto no mintiera.
    const strings = {
      newFolder: t('New folder'), refresh: t('Refresh'), sortAll: t('Sort everything A-Z'),
      sort: t('Sort A-Z'), rename: t('Rename folder'), renameTile: t('Rename icon'),
      resetName: t('Use original name'), remove: t('Remove from folder'), del: t('Delete folder'),
      disable: t('Turn extension off'), enable: t('Turn extension on'),
      uninstall: t('Uninstall extension'), forget: t('Remove from the board'),
      hide: t('Hide icon'), unhide: t('Show icon'), showHiddenOn: t('Show hidden icons'),
      showHiddenOff: t('Stop showing hidden icons'), unhideAll: t('Show all hidden icons'),
      pickFirst: modKey(t('Ctrl+click icons to pick several')),
      disableSel: t('Turn the selected ones off'), enableSel: t('Turn the selected ones on'),
      mixedPick: t('Some are on and some are off: pick only one kind'),
      uninstallSel: t('Uninstall the selected ones'),
      checkUpdates: t('Check for updates'), update: t('Update to {0}'),
      split: t('Split this group'), face: t('Choose the icon of the group'),
      hint: modKey(t('Drag one icon onto another to join them. Ctrl+click picks several; tap Ctrl twice to drop them.')),
    };
    return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${w.cspSource} data:; style-src ${w.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${uri('board.css')}">
</head><body>
<div id="brand"><img src="${uri('gg-groups.svg')}" alt=""><span>GG Groups</span></div>
<div id="rail"><div id="items"></div><div id="actions"></div></div>
<div id="hint"></div>
<script nonce="${nonce}">window.STR = ${JSON.stringify(strings)};
window.ICONS = ${JSON.stringify(icons)};
document.getElementById('hint').textContent = window.STR.hint;</script>
<script nonce="${nonce}" src="${uri('board.js')}"></script>
</body></html>`;
  }
}

function activate(context) {
  loadStrings(context);
  const board = new Board(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('viewGroups.board', board, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.extensions.onDidChange(() => board.refresh()),
    // Atajo y boton del editor: solo enfocan la vista lateral.
    vscode.commands.registerCommand('viewGroups.show', () =>
      vscode.commands.executeCommand('viewGroups.board.focus')),
    vscode.commands.registerCommand('viewGroups.unhideAll', () =>
      board.onMessage({ type: 'unhideAll' })),
    vscode.commands.registerCommand('viewGroups.checkUpdates', () => board.checkUpdates()),
    vscode.commands.registerCommand('viewGroups.selfTest', async () => {
      const out = vscode.window.createOutputChannel('GG Groups');
      out.clear();
      out.appendLine(t('GG Groups check'));
      out.appendLine('');
      const problemas = await board.selfTest(out);
      out.appendLine('');
      out.appendLine(problemas.length ? '✗ ' + problemas.length : '✓ ' + t('Everything checks out.'));
      for (const x of problemas) out.appendLine('  - ' + x);
      out.show();
      if (problemas.length) vscode.window.showWarningMessage(t('The check found {0} problem(s).', problemas.length));
      else vscode.window.showInformationMessage(t('Everything checks out.'));
    }),
    vscode.commands.registerCommand('viewGroups.diagnose', async () => {
      const out = vscode.window.createOutputChannel('GG Groups');
      out.appendLine('idioma detectado: ' + (context.globalState.get(KEY_LOCALE) || systemLocale()));
      out.appendLine('locale de ICU: ' + systemLocale());
      out.appendLine('plataforma: ' + process.platform + ' | VS Code: ' + vscode.version);
      out.appendLine('');
      out.appendLine('comandos de mover vistas:');
      for (const c of await board.moveCommands()) out.appendLine('  ' + c);
      out.appendLine('');
      out.appendLine('comandos de chat (el icono usa el primero que encaje):');
      try {
        for (const c of (await vscode.commands.getCommands(true)).filter((c2) => /chat/i.test(c2)).sort()) {
          out.appendLine('  ' + c);
        }
      } catch { out.appendLine('  (no se pudo consultar)'); }
      out.show();
    })
  );
  // El idioma real se resuelve antes de sembrar: si no, la carpeta nativa se crearia
  // con el nombre en ingles y ya se quedaria asi para siempre.
  osLocale(context)
    .then((lang) => loadStrings(context, lang))
    .catch(() => {})
    .then(() => board.refresh())
    .then(() => board.seed());
}

module.exports = {
  activate, deactivate() {},
  Board, discover, keepClickable, normalize, insert, loadStrings, systemLocale, osLocale,
  NATIVE, NATIVE_KEYS, CORE, DEV_CONTAINERS, ensureNative, refineChat, whenValue, containerShows, pickIcon,
  restartCommand, findPython, modKey, cleanEnv, installedExtensions, displayName, assignGroups,
  marketplaceQuery, newerVersion, parseUpdates, iconGroup, familias,
};
