const vscode = require('vscode');
const fs = require('fs');
const { execFile } = require('child_process');

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
const KEY_OFF = 'viewGroups.off';               // solo para limpiar el estado de versiones viejas
/**
 * Desactivar una extension NO se puede hacer por codigo: no hay API, y los comandos de
 * `workbench` o no existen o aceptan la llamada y la ignoran sin avisar — resuelven bien
 * y no desactivan nada. Fiarse de eso llevaba a pintar en gris extensiones que seguian
 * cargandose en cada arranque. Asi que el estado ya no se supone: una extension figura
 * apagada solo cuando VS Code deja de cargarla de verdad, y para apagarla se lleva al
 * usuario a su ficha, donde el boton si funciona.
 */
const EXT_PAGE_CMDS = ['extension.open', 'workbench.extensions.search'];
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
const CORE = [
  ['k:chat', 'workbench.action.chat.open', 'Chat', 'copilot'],
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
function discover(ctx) {
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
  for (const [key, cmd, name, icon] of CORE) {
    if (tiles.some((x) => x.cmd === cmd)) continue;
    tiles.push({ key, cmd, label: t(name), owner: 'Visual Studio Code', ext: 'vscode', icon: codiconIcon(ctx, icon) });
  }

  const seen = new Set();
  return tiles.filter((x) => !seen.has(x.key) && seen.add(x.key));
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
  return tiles.filter((x) => known.has(x.cmd));
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
    this.tiles = discover(ctx);
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
    const live = await keepClickable(discover(this.ctx));

    // El catalogo se pone al dia con lo que hay cargado ahora.
    const catalogo = new Map(this.seen.map((o) => [o.key, o]));
    for (const x of live) {
      if (x.ext === 'vscode') continue;                       // los de fabrica no se apagan
      catalogo.set(x.key, {
        ext: x.ext, key: x.key, cmd: x.cmd, label: x.label, owner: x.owner,
        iconPath: x.icon ? x.icon.uri.fsPath : null, mask: !!(x.icon && x.icon.mask),
      });
    }
    await this.ctx.globalState.update(KEY_SEEN, [...catalogo.values()]);
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

  /** Apagar: se abre su ficha para que el usuario pulse Deshabilitar. */
  async disable(key) {
    const tile = this.tiles.find((x) => x.key === key);
    if (!tile || tile.off || tile.native || !tile.ext || tile.ext === 'vscode') return;
    await this.openExtensionPage(tile.ext, t('Press Disable there. When you reload, it will show greyed out here.'));
  }

  /** Encender: lo mismo, con el boton de Habilitar. */
  async enable(key) {
    const entry = this.off.find((o) => o.key === key);
    if (!entry) return;
    await this.openExtensionPage(entry.ext, t('Press Enable there. When you reload, it will come back to its place.'));
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
    say('apagar extensiones: se hace desde su ficha (VS Code no lo expone a las extensiones)');
    say('apagadas ahora mismo: ' + (this.off.map((o) => o.label).join(', ') || 'ninguna'));
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

  async dockRight(silent) {
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
    if (!silent) await this.dockManually();
    return false;
  }

  /** Respaldo: se abre la barra derecha y se le pide al usuario que arrastre el icono. */
  async dockManually() {
    try {
      await vscode.commands.executeCommand('workbench.action.focusAuxiliaryBar');
    } catch { /* ni siquiera eso: al menos queda el aviso */ }
    vscode.window.showInformationMessage(t('Now drag the Groups icon into the right bar.'));
  }

  /** La primera vez el tablero se ancla solo a la barra derecha, para no taparse. */
  async autoDock() {
    if (this.ctx.globalState.get(KEY_DOCKED)) return;
    await this.ctx.globalState.update(KEY_DOCKED, true);
    // En el arranque no se molesta al usuario: si no se puede, queda donde esta.
    await this.dockRight(true);
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
    const on = list.filter((x) => !x.off);
    const off = list.filter((x) => x.off).sort((a, b) => this.nameOf(a).localeCompare(this.nameOf(b)));
    return [...on, ...off];
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
    return this.showHidden ? this.tiles : this.tiles.filter((x) => !hidden.has(x.key));
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
    return list;
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
      hidden: hidden.has(x.key),
      renamed: typeof names[x.key] === 'string',
    });
    w.postMessage({
      type: 'state',
      showHidden: this.showHidden,
      hiddenCount: hidden.size,
      folders: folders.map((f) => ({
        name: f.name,
        locked: !!f.locked,
        // El bloque nativo se pinta siempre en el orden de la barra de VS Code.
        tiles: this.offLast((f.locked ? NATIVE_KEYS.filter((k) => f.keys.includes(k)) : f.keys)
          .map((k) => byKey.get(k)).filter(Boolean)).map(pack),
      })),
      loose: this.looseTiles(folders).map(pack),
    });
  }

  /** Ejecuta el comando de la baldosa sin quedarse colgado si nunca responde. */
  async open(key) {
    const tile = this.tiles.find((x) => x.key === key);
    if (!tile) return;
    if (tile.off) return this.enable(key);          // apagada: pulsarla la vuelve a encender
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
      case 'disable':
        return this.disable(m.key);
      case 'enable':
        return this.enable(m.key);
      case 'forget':
        return this.forget(m.key);
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
      case 'dock':
        return this.dockRight();
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
    const strings = {
      newFolder: t('New folder'), refresh: t('Refresh'), sortAll: t('Sort everything A-Z'),
      sort: t('Sort A-Z'), rename: t('Rename folder'), renameTile: t('Rename icon'),
      resetName: t('Use original name'), remove: t('Remove from folder'), del: t('Delete folder'),
      disable: t('Turn extension off...'), enable: t('Turn extension on...'),
      forget: t('Remove from the board'),
      hide: t('Hide icon'), unhide: t('Show icon'), showHiddenOn: t('Show hidden icons'),
      showHiddenOff: t('Stop showing hidden icons'), unhideAll: t('Show all hidden icons'),
      dock: t('Move the board to the right bar'),
      hint: t('Drag one icon onto another to group them.'),
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
};
