// Logica de extension.js contra las extensiones realmente instaladas en la maquina.
const fs = require('fs'), path = require('path'), os = require('os'), Module = require('module'), assert = require('assert');

const ROOT = path.join(__dirname, '..');
const installed = require('./fixtures/extensions.js');

let inputAnswer = 'IAs';
const infos = [];
let infoAnswer = null;
let quickAnswer = null;
const avisos = [];
let warnAnswer = null;
// Ajustes simulados para evaluar las clausulas `when` que dependen de config.*
const ajustes = { 'acme.showPanel': { defaultValue: false } };
let registered = null;              // null = todos los comandos existen
const stub = {
  env: { language: 'en' },
  extensions: { all: installed, onDidChange: () => ({ dispose() {} }) },
  Uri: { joinPath: (base, ...p) => ({ fsPath: path.join(base.fsPath, ...p) }), file: (p) => ({ fsPath: p }) },
  workspace: { getConfiguration: () => ({ inspect: (k) => ajustes[k] }) },
  window: {
    showInputBox: async () => inputAnswer,
    showInformationMessage: async (...a) => { infos.push(a); return infoAnswer; },
    showQuickPick: async (opciones) => opciones.find((o) => o.id === quickAnswer) || null,
    showErrorMessage: (m) => { throw new Error('error UI inesperado: ' + m); },
    showWarningMessage: (m, ...resto) => { avisos.push(m); return warnAnswer; },
    createOutputChannel: () => ({ appendLine() {}, clear() {}, show() {} }),
    registerWebviewViewProvider: () => ({ dispose() {} }),
  },
  commands: {
    registerCommand: () => ({ dispose() {} }),
    executeCommand: async () => {},
    getCommands: async () => registered,
  },
};
const orig = Module._load;
Module._load = (r, ...a) => (r === 'vscode' ? stub : orig(r, ...a));
const mod = new Module('view-groups');
mod._compile(fs.readFileSync(path.join(ROOT, 'extension.js'), 'utf8'), 'extension.js');
Module._load = orig;

const { Board, discover, keepClickable, normalize, insert, loadStrings, systemLocale, osLocale, NATIVE, NATIVE_KEYS, CORE, DEV_CONTAINERS, ensureNative, refineChat, whenValue, containerShows, pickIcon,
  restartCommand } = mod.exports;
const CTX = { extensionUri: { fsPath: ROOT } };
const tiles = discover(CTX);
// Iconos que el usuario puede mover: los nativos van bloqueados y no valen para estas pruebas.
const free = tiles.filter((x) => !NATIVE_KEYS.includes(x.key));
/** Las carpetas del usuario, sin el bloque nativo que siempre esta. */
const userFolders = (b) => b.folders.filter((f) => !f.locked);

/** Un tablero nuevo con estado en memoria y un webview de mentira. */
function makeBoard(initial) {
  // Por defecto el tablero ya esta anclado: solo las pruebas del anclaje lo desactivan,
  // asi no queda ningun movimiento pendiente que se cuele en la prueba siguiente.
  const store = new Map(Object.entries({ 'viewGroups.docked': true, ...initial }));
  const posted = [];
  const b = new Board({
    globalState: { get: (k, d) => (store.has(k) ? store.get(k) : d), update: async (k, v) => store.set(k, v) },
    extensionUri: { fsPath: ROOT },
  });
  b.panel = { webview: { postMessage: (m) => posted.push(m), asWebviewUri: (u) => 'vsc://' + u.fsPath } };
  b.posted = posted;
  b.last = () => posted[posted.length - 1];
  b.store = store;
  return b;
}

// --- descubrimiento ---

test('descubre contenedores, vistas y los siete iconos nativos', () => {
  assert.ok(installed.length > 0, 'no hay extensiones instaladas para probar');
  assert.strictEqual(tiles.filter((x) => x.native).length, NATIVE.length);
  assert.ok(tiles.filter((x) => x.key.startsWith('c:')).length > 0, 'ningun contenedor');
});

test('los nativos van primero y traen su dibujo', () => {
  const first = tiles.slice(0, NATIVE.length);
  assert.ok(first.every((x) => x.native && x.icon && x.icon.mask));
  const missing = first.filter((x) => !fs.existsSync(x.icon.uri.fsPath));
  assert.deepStrictEqual(missing.map((x) => x.key), [], 'faltan dibujos de los nativos');
});

test('las claves no se repiten', () => {
  assert.strictEqual(new Set(tiles.map((x) => x.key)).size, tiles.length);
});

test('ya no aparecen temas ni paquetes de idioma (no abren nada)', () => {
  assert.deepStrictEqual(tiles.filter((x) => x.key.startsWith('x:')).map((x) => x.key), []);
});

test('ninguna vista condicional se cuela', () => {
  // Son las que dejaban el panel en negro: existen en el manifiesto pero no siempre en VS Code.
  const conditional = new Set();
  for (const ext of installed) {
    for (const vs of Object.values((ext.packageJSON.contributes || {}).views || {})) {
      for (const v of vs || []) if (v && v.id && v.when) conditional.add('v:' + v.id);
    }
  }
  assert.ok(conditional.size > 0, 'el escenario de prueba no tiene vistas con when');
  assert.deepStrictEqual(tiles.filter((x) => conditional.has(x.key)).map((x) => x.key), []);
});

test('cada icono apunta a un archivo que existe', () => {
  const missing = tiles.filter((x) => x.icon && !fs.existsSync(x.icon.uri.fsPath));
  assert.deepStrictEqual(missing.map((x) => x.icon.uri.fsPath), []);
});

test('sin logo de marketplace se usa el icono de la barra lateral', () => {
  // Declara "$(key)": debe salir el dibujo de la llave, no la inicial.
  const kr = tiles.find((x) => x.key === 'c:keysView');
  assert.ok(kr, 'falta la pieza de prueba');
  assert.ok(kr.icon, 'se quedo sin icono');
  assert.ok(kr.icon.uri.fsPath.endsWith('key.svg'), 'no resolvio el codicon: ' + kr.icon.uri.fsPath);
  assert.strictEqual(kr.icon.mask, true, 'un dibujo de un color debe pintarse con el tema');
});

test('un icono .svg se marca para pintarse con el color del tema', () => {
  const svgs = tiles.filter((x) => x.icon && /\.svg$/i.test(x.icon.uri.fsPath));
  assert.ok(svgs.length > 0);
  assert.ok(svgs.every((x) => x.icon.mask));
  const raster = tiles.filter((x) => x.icon && /\.(png|jpe?g|gif)$/i.test(x.icon.uri.fsPath));
  assert.ok(raster.every((x) => !x.icon.mask), 'un png no debe enmascararse');
});

test('descarta lo que VS Code no tiene registrado', async () => {
  registered = tiles.slice(0, 3).map((x) => x.cmd);
  const kept = await keepClickable(tiles);
  assert.deepStrictEqual(kept.map((x) => x.cmd).sort(), [...registered].sort());
  registered = null;
});

test('si no se puede consultar la lista de comandos, no se esconde nada', async () => {
  const real = stub.commands.getCommands;
  stub.commands.getCommands = async () => { throw new Error('sin API'); };
  assert.strictEqual((await keepClickable(tiles)).length, tiles.length);
  stub.commands.getCommands = real;
});

// --- estado ---

test('migra el estado de la version 0.3 (cmds -> keys)', () => {
  const out = normalize([{ name: 'IAs', cmds: ['workbench.view.extension.notesView', 'notesTree.focus'] }]);
  assert.deepStrictEqual(out, [{ name: 'IAs', keys: ['c:notesView', 'v:notesTree'] }]);
});

test('el estado corrupto no rompe nada', () => {
  assert.deepStrictEqual(normalize(null), []);
  assert.deepStrictEqual(normalize('x'), []);
  assert.deepStrictEqual(normalize([null, 5, { sin: 'nombre' }]), []);
  assert.deepStrictEqual(normalize([{ name: 'A' }]), [{ name: 'A', keys: [] }]);
  assert.deepStrictEqual(normalize([{ name: 'A', keys: [1, 'b:x', null] }]), [{ name: 'A', keys: ['b:x'] }]);
});

test('renderiza sin fallar sobre un estado de la version vieja', () => {
  const b = makeBoard({ 'viewGroups.folders': [{ name: 'IAs', cmds: ['workbench.view.extension.nada'] }] });
  b.render();
  const ias = b.last().folders.find((f) => f.name === 'IAs');
  assert.ok(ias, 'se perdio la carpeta migrada');
  assert.deepStrictEqual(ias.tiles, []);
});

test('insert coloca delante de la referencia, o al final si no esta', () => {
  assert.deepStrictEqual(insert(['a', 'b', 'c'], ['c'], 'a'), ['c', 'a', 'b']);
  assert.deepStrictEqual(insert(['a', 'b', 'c'], ['a'], null), ['b', 'c', 'a']);
  assert.deepStrictEqual(insert(['a', 'b', 'c'], ['a'], 'zzz'), ['b', 'c', 'a']);
  assert.deepStrictEqual(insert(['a', 'b', 'c'], ['a'], 'a'), ['b', 'c', 'a']);
});

// --- carpeta Nativo ---

test('siembra la carpeta Nativo arriba del todo, una sola vez', async () => {
  const b = makeBoard();
  await b.seed();
  const block = b.folders[0];
  assert.strictEqual(block.name, 'Native');
  assert.strictEqual(block.locked, true, 'el bloque nativo debe quedar bloqueado');
  assert.deepStrictEqual(block.keys, NATIVE_KEYS);
  // Y esta bloqueada: no se puede borrar, renombrar ni reordenar.
  await b.onMessage({ type: 'delete', folder: 'Native' });
  await b.onMessage({ type: 'rename', folder: 'Native' });
  await b.onMessage({ type: 'sort', folder: 'Native' });
  assert.strictEqual(b.folders.length, 1);
  assert.deepStrictEqual(b.folders[0].keys, NATIVE_KEYS);
  // Y sembrar otra vez no la duplica.
  await b.seed();
  assert.strictEqual(b.folders.length, 1);
});

test('los iconos nativos no se sacan, ni se mueven, ni se ocultan', async () => {
  const b = makeBoard();
  await b.seed();
  const antes = JSON.stringify(b.folders);
  for (const m of [
    { type: 'ungroup', keys: ['n:search'] },
    { type: 'move', keys: ['n:search'], before: 'n:explorer' },
    { type: 'moveTo', keys: ['n:search'], folder: 'Native' },
    { type: 'hide', keys: ['n:scm'] },
    { type: 'group', keys: [tiles.find((x) => !x.native).key], target: 'n:explorer' },
  ]) {
    await b.onMessage(m);
  }
  assert.strictEqual(JSON.stringify(b.folders), antes, 'algo movio el bloque nativo');
  assert.ok(!b.hidden.has('n:scm'), 'se oculto un nativo');
});

test('el bloque nativo se pinta en el orden de la barra de VS Code', async () => {
  const b = makeBoard();
  await b.seed();
  // Aunque el guardado venga desordenado, se muestra en el orden oficial.
  const revuelto = [...NATIVE_KEYS].reverse();
  b.store.set('viewGroups.folders', [{ name: 'Native', keys: revuelto, locked: true }]);
  b.render();
  assert.deepStrictEqual(b.last().folders[0].tiles.map((x) => x.key), NATIVE_KEYS);
  assert.strictEqual(b.last().folders[0].locked, true);
});

test('la carpeta Nativo se coloca delante de las que ya existan', async () => {
  const b = makeBoard({ 'viewGroups.folders': [{ name: 'IAs', keys: [] }] });
  await b.seed();
  assert.deepStrictEqual(b.folders.map((f) => f.name), ['Native', 'IAs']);
});

// --- organizar ---

test('de fabrica salen en orden alfabetico', () => {
  const b = makeBoard();
  const labels = b.looseTiles().map((x) => x.label);
  assert.deepStrictEqual(labels, [...labels].sort((a, x) => a.localeCompare(x)));
});

test('arrastrar un icono sobre otro crea la carpeta', async () => {
  const b = makeBoard();
  await b.onMessage({ type: 'group', keys: [free[0].key], target: free[1].key });
  assert.deepStrictEqual(userFolders(b), [{ name: 'IAs', keys: [free[1].key, free[0].key] }]);
});

test('un icono no puede estar en dos carpetas a la vez', async () => {
  const b = makeBoard({
    'viewGroups.folders': [{ name: 'A', keys: [free[0].key] }, { name: 'B', keys: [] }],
  });
  await b.onMessage({ type: 'moveTo', keys: [free[0].key], folder: 'B' });
  assert.deepStrictEqual(userFolders(b), [{ name: 'A', keys: [] }, { name: 'B', keys: [free[0].key] }]);
});

test('mover entre iconos reordena y el orden se guarda', async () => {
  const b = makeBoard();
  const before = b.looseTiles().map((x) => x.key);
  const last = before[before.length - 1];
  await b.onMessage({ type: 'move', keys: [last], before: before[0] });
  assert.strictEqual(b.looseTiles()[0].key, last);
  b.render();
  assert.strictEqual(b.last().loose[0].key, last, 'el orden no sobrevive al repintado');
});

test('reordenar dentro de una carpeta no la saca', async () => {
  const [a, c] = [free[0].key, free[1].key];
  const b = makeBoard({ 'viewGroups.folders': [{ name: 'A', keys: [a, c] }] });
  await b.onMessage({ type: 'move', keys: [c], before: a });
  assert.deepStrictEqual(userFolders(b)[0].keys, [c, a]);
});

test('ordenar una carpeta la deja alfabetica sin tocar las demas', async () => {
  const keys = free.slice(0, 6).map((x) => x.key).reverse();
  const b = makeBoard({ 'viewGroups.folders': [{ name: 'A', keys }, { name: 'B', keys: [] }] });
  await b.onMessage({ type: 'sort', folder: 'A' });
  const labels = userFolders(b)[0].keys.map((k) => tiles.find((x) => x.key === k).label);
  assert.deepStrictEqual(labels, [...labels].sort((x, y) => x.localeCompare(y)));
  assert.strictEqual(userFolders(b).length, 2);
});

test('ordenar todo borra el orden manual de los sueltos', async () => {
  const b = makeBoard();
  const list = b.looseTiles().map((x) => x.key);
  await b.onMessage({ type: 'move', keys: [list[list.length - 1]], before: list[0] });
  await b.onMessage({ type: 'sort' });
  const labels = b.looseTiles().map((x) => x.label);
  assert.deepStrictEqual(labels, [...labels].sort((x, y) => x.localeCompare(y)));
});

test('sacar de la carpeta y borrarla', async () => {
  const b = makeBoard({ 'viewGroups.folders': [{ name: 'A', keys: [free[0].key, free[1].key] }] });
  await b.onMessage({ type: 'ungroup', keys: [free[0].key] });
  assert.deepStrictEqual(userFolders(b)[0].keys, [free[1].key]);
  await b.onMessage({ type: 'delete', folder: 'A' });
  assert.deepStrictEqual(userFolders(b), []);
});

test('reordenar carpetas', async () => {
  const b = makeBoard({
    'viewGroups.folders': [{ name: 'A', keys: [] }, { name: 'B', keys: [] }, { name: 'C', keys: [] }],
  });
  await b.onMessage({ type: 'reorder', folder: 'C', before: 'A' });
  assert.deepStrictEqual(userFolders(b).map((f) => f.name), ['C', 'A', 'B']);
});

test('renombrar respeta los iconos que contiene', async () => {
  const b = makeBoard({ 'viewGroups.folders': [{ name: 'A', keys: [free[0].key] }] });
  inputAnswer = 'Nuevo';
  await b.onMessage({ type: 'rename', folder: 'A' });
  inputAnswer = 'IAs';
  assert.deepStrictEqual(userFolders(b), [{ name: 'Nuevo', keys: [free[0].key] }]);
});

test('lo que esta en una carpeta no se repite fuera', () => {
  const b = makeBoard({ 'viewGroups.folders': [{ name: 'A', keys: [free[0].key] }] });
  b.render();
  const st = b.last();
  assert.strictEqual(st.folders.find((f) => f.name === 'A').tiles.length, 1);
  assert.ok(!st.loose.some((x) => x.key === free[0].key));
});

test('los iconos viajan al webview como uri de webview', () => {
  const b = makeBoard();
  b.render();
  const withIcon = b.last().loose.filter((x) => x.icon);
  assert.ok(withIcon.length > 0);
  assert.ok(withIcon.every((x) => x.icon.startsWith('vsc://')));
  assert.ok(b.last().loose.some((x) => x.mask), 'no llega la marca de dibujo monocromo');
});

// --- robustez ---

test('mensajes malformados del webview no tocan el estado', async () => {
  const b = makeBoard({ 'viewGroups.folders': [{ name: 'A', keys: [free[0].key] }] });
  const before = JSON.stringify(b.folders);
  for (const m of [null, undefined, {}, { type: 42 }, { type: 'group' }, { type: 'group', keys: 'x' },
                   { type: 'moveTo', keys: [free[1].key], folder: 'no existe' },
                   { type: 'group', keys: [free[0].key], target: free[0].key },
                   { type: 'reorder', folder: 'A', before: 'A' }, { type: 'sort', folder: 'no existe' },
                   { type: 'delete' }, { type: 'rename', folder: 'no existe' }, { type: 'desconocido' }]) {
    await b.onMessage(m);
  }
  assert.strictEqual(JSON.stringify(b.folders), before);
});

test('abrir un icono inexistente no lanza', async () => {
  await makeBoard().onMessage({ type: 'open', key: 'c:no-existe' });
});

test('desechar la vista vieja despues de crear la nueva no deja el panel muerto', () => {
  const b = makeBoard();
  const mk = () => {
    let dispose = null;
    const v = {
      webview: { postMessage() {}, asWebviewUri: (u) => 'vsc://' + u.fsPath, cspSource: 'vsc:',
                 html: '', onDidReceiveMessage() {} },
      onDidDispose: (fn) => { dispose = fn; },
      onDidChangeVisibility: () => {},
      visible: true,
    };
    return { v, kill: () => dispose && dispose() };
  };
  const first = mk(), second = mk();
  b.resolveWebviewView(first.v);
  b.resolveWebviewView(second.v);
  first.kill();
  assert.strictEqual(b.panel, second.v, 'se perdio la vista viva');
});

test('un comando que nunca responde avisa en vez de colgar el panel', async () => {
  const b = makeBoard();
  const errors = [];
  const realExec = stub.commands.executeCommand, realErr = stub.window.showErrorMessage;
  stub.commands.executeCommand = () => new Promise(() => {});
  stub.window.showErrorMessage = (msg) => errors.push(msg);
  const started = Date.now();
  const p = b.open(free[0].key);
  await new Promise((r) => setTimeout(r, 4100));
  await p;
  stub.commands.executeCommand = realExec;
  stub.window.showErrorMessage = realErr;
  assert.strictEqual(errors.length, 1, 'no aviso del comando colgado');
  assert.ok(Date.now() - started >= 4000);
});

// --- manifiesto y traducciones ---

test('la vista lateral se resuelve, se cablea y pinta al abrirse', () => {
  const b = makeBoard();
  const posted = [];
  let html = '', handler = null;
  const view = {
    webview: {
      postMessage: (m) => posted.push(m),
      asWebviewUri: (u) => 'vsc://' + u.fsPath,
      cspSource: 'vsc:',
      set html(v) { html = v; },
      get html() { return html; },
      onDidReceiveMessage: (fn) => { handler = fn; },
    },
    onDidDispose: () => {},
  };
  b.resolveWebviewView(view);
  assert.ok(view.webview.options.enableScripts);
  assert.ok(view.webview.options.localResourceRoots.length > 1);
  assert.ok(html.includes('id="items"'));
  assert.strictEqual(typeof handler, 'function');
  assert.strictEqual(posted.length, 1);
});

test('el HTML que sirve la extension trae los nodos y cadenas que espera el webview', () => {
  const b = makeBoard();
  const html = b.html({ asWebviewUri: (u) => 'vsc://' + u.fsPath, cspSource: 'vsc:' });
  for (const id of ['id="brand"', 'id="rail"', 'id="items"', 'id="actions"', 'id="hint"']) {
    assert.ok(html.includes(id), 'falta ' + id);
  }
  assert.ok(html.includes('board.css') && html.includes('board.js'));
  assert.ok(html.includes('gg-groups.svg'), 'la cabecera se quedo sin logo');
  assert.ok(/nonce-\d+/.test(html) && html.includes("default-src 'none'"));
  const str = JSON.parse(html.match(/window\.STR = (\{.*?\});/s)[1]);
  for (const k of ['newFolder', 'refresh', 'sortAll', 'sort', 'rename', 'remove', 'del', 'hint']) {
    assert.ok(str[k], 'falta la cadena ' + k);
  }
});

test('todas las cadenas del codigo estan traducidas y no sobra ninguna', () => {
  const src = fs.readFileSync(path.join(ROOT, 'extension.js'), 'utf8');
  const used = new Set([...src.matchAll(/\bt\('([^']*)'/g)].map((m) => m[1]));
  for (const [, , name] of [...NATIVE, ...CORE]) used.add(name);   // se traducen con t(variable)
  const es = JSON.parse(fs.readFileSync(path.join(ROOT, 'l10n', 'bundle.l10n.es.json'), 'utf8'));
  assert.deepStrictEqual([...used].filter((k) => !(k in es)).sort(), [], 'sin traducir');
  assert.deepStrictEqual(Object.keys(es).filter((k) => !used.has(k)).sort(), [], 'traducciones que sobran');
});

test('las claves %nls% del manifiesto existen en los dos idiomas', () => {
  const pkg = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
  const keys = [...new Set([...pkg.matchAll(/"%([^%]+)%"/g)].map((m) => m[1]))];
  assert.ok(keys.length > 0);
  for (const f of ['package.nls.json', 'package.nls.es.json']) {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    assert.deepStrictEqual(keys.filter((k) => !(k in d)), [], 'faltan claves en ' + f);
  }
});

test('el manifiesto declara la vista lateral y su activacion', () => {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const view = d.contributes.views.viewGroups[0];
  assert.strictEqual(view.type, 'webview', 'sin type:webview VS Code espera un arbol');
  // Sin esto la vista se queda en "An error occurred while loading view".
  assert.ok(d.activationEvents.includes('onView:' + view.id));
  assert.ok(d.contributes.viewsContainers.activitybar.some((c) => c.id === 'viewGroups'));
});


// --- anclaje a la barra derecha ---

/** Board con la lista de comandos y el registro de lo ejecutado bajo control. */
function dockBoard(comandos, initial) {
  const b = makeBoard({ 'viewGroups.docked': false, ...initial });
  b.ejecutados = [];
  b.realExec = stub.commands.executeCommand;
  b.realCmds = stub.commands.getCommands;
  stub.commands.getCommands = async () => comandos;
  stub.commands.executeCommand = async (c) => {
    b.ejecutados.push(c);
    if (comandos && c.startsWith('workbench.action.move') && !comandos.includes(c)) {
      throw new Error('comando desconocido');
    }
  };
  b.restore = () => {
    stub.commands.executeCommand = b.realExec;
    stub.commands.getCommands = b.realCmds;
  };
  return b;
}

test('al abrirse por primera vez se ancla solo a la barra derecha', async () => {
  const b = dockBoard(['viewGroups.board.focus', 'workbench.action.moveFocusedViewToSecondarySideBar']);
  await b.autoDock();
  assert.deepStrictEqual(b.ejecutados,
    ['viewGroups.board.focus', 'workbench.action.moveFocusedViewToSecondarySideBar']);
  // Y no vuelve a moverlo nunca: a partir de ahi manda el usuario.
  b.ejecutados.length = 0;
  await b.autoDock();
  assert.deepStrictEqual(b.ejecutados, []);
  b.restore();
});

test('encuentra el comando aunque VS Code le haya cambiado el nombre', async () => {
  const b = dockBoard(['viewGroups.board.focus', 'workbench.action.moveActiveViewToAuxiliaryBar']);
  assert.strictEqual(await b.dockRight(), true);
  assert.deepStrictEqual(b.ejecutados,
    ['viewGroups.board.focus', 'workbench.action.moveActiveViewToAuxiliaryBar']);
  b.restore();
});

test('si ninguna variante existe, no se insiste ni se molesta', () => {
  const b = dockBoard(['viewGroups.board.focus']);
  infos.length = 0;
  return b.dockRight().then((ok) => {
    assert.strictEqual(ok, false);
    assert.strictEqual(infos.length, 0, 'anclar es una comodidad, no algo que anunciar');
    b.restore();
  });
});

test('abrir la vista dispara el anclaje sin bloquear el pintado', async () => {
  const b = dockBoard(['viewGroups.board.focus', 'workbench.action.moveFocusedViewToSecondarySideBar']);
  const posted = [];
  b.resolveWebviewView({
    webview: { postMessage: (m) => posted.push(m), asWebviewUri: (u) => 'vsc://' + u.fsPath,
               cspSource: 'vsc:', html: '', onDidReceiveMessage() {} },
    onDidDispose: () => {},
  });
  assert.strictEqual(posted.length, 1, 'el pintado debe ser inmediato');
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(b.ejecutados.includes('workbench.action.moveFocusedViewToSecondarySideBar'));
  b.restore();
});

test('prueba una variante tras otra hasta que alguna funcione', async () => {
  const b = dockBoard([
    'viewGroups.board.focus',
    'workbench.action.moveFocusedViewToSecondarySideBar',   // esta fallara
    'workbench.action.moveActiveViewToAuxiliaryBar',        // esta funciona
  ]);
  const real = stub.commands.executeCommand;
  stub.commands.executeCommand = async (c) => {
    b.ejecutados.push(c);
    if (c.endsWith('SecondarySideBar')) throw new Error('no movible');
  };
  assert.strictEqual(await b.dockRight(), true);
  assert.deepStrictEqual(b.ejecutados.filter((c) => /move/i.test(c)),
    ['workbench.action.moveFocusedViewToSecondarySideBar', 'workbench.action.moveActiveViewToAuxiliaryBar']);
  stub.commands.executeCommand = real;
  b.restore();
});

test('el idioma se pregunta al sistema y se guarda para no repetirlo', async () => {
  const store = new Map();
  const ctx = {
    globalState: { get: (k, d) => (store.has(k) ? store.get(k) : d), update: async (k, v) => store.set(k, v) },
    extensionUri: { fsPath: ROOT },
  };
  const lang = await osLocale(ctx);
  assert.ok(/^[a-z]{2}$/.test(lang), 'idioma raro: ' + lang);
  assert.strictEqual(store.get('viewGroups.locale'), lang, 'no se guardo');
  if (process.platform === 'win32') {
    // En este equipo el sistema esta en espanol: no debe salir el idioma de VS Code.
    assert.strictEqual(lang, 'es');
  }
  // La segunda vez sale del guardado, sin volver a preguntar al sistema.
  store.set('viewGroups.locale', 'fr');
  assert.strictEqual(await osLocale(ctx), 'fr');
});

// --- el bloque nativo es indestructible ---

test('borrar la carpeta Nativo la devuelve intacta', async () => {
  const b = makeBoard();
  await b.seed();
  await b.onMessage({ type: 'delete', folder: 'Native' });
  const block = b.folders.find((f) => f.locked);
  assert.ok(block, 'se perdio el bloque nativo');
  assert.deepStrictEqual(block.keys, NATIVE_KEYS);
});

test('un estado sin bloque nativo se repara al leerlo', () => {
  const b = makeBoard({ 'viewGroups.folders': [{ name: 'IAs', keys: ['c:algo'] }] });
  const block = b.folders.find((f) => f.locked);
  assert.ok(block, 'no lo reconstruyo');
  assert.strictEqual(block.name, 'Native');
  assert.deepStrictEqual(block.keys, NATIVE_KEYS);
  assert.deepStrictEqual(b.folders.map((f) => f.name), ['Native', 'IAs'], 'debe quedar al principio');
});

test('una carpeta nativa de una version vieja, sin marca, queda bloqueada', () => {
  // Asi era antes: sin `locked`, y por eso se dejaba borrar.
  const b = makeBoard({ 'viewGroups.folders': [{ name: 'Nativo', keys: ['n:explorer', 'n:search'] }] });
  const block = b.folders.find((f) => f.name === 'Nativo');
  assert.strictEqual(block.locked, true);
  assert.deepStrictEqual(block.keys, NATIVE_KEYS, 'y se completa con los que faltaban');
});

test('ningun nativo puede acabar en otra carpeta', () => {
  const b = makeBoard({ 'viewGroups.folders': [
    { name: 'IAs', keys: ['n:explorer', 'c:algo'] },
    { name: 'Native', keys: NATIVE_KEYS, locked: true },
  ] });
  assert.deepStrictEqual(b.folders.find((f) => f.name === 'IAs').keys, ['c:algo']);
});

test('ensureNative no duplica el bloque ni pierde carpetas', () => {
  const out = ensureNative([{ name: 'A', keys: [] }, { name: 'Nativo', keys: NATIVE_KEYS, locked: true }], 'Native');
  assert.strictEqual(out.filter((f) => f.locked).length, 1);
  assert.deepStrictEqual(out.map((f) => f.name), ['Nativo', 'A'], 'el bloque sube al primer puesto');
});

// --- los ocultos siempre se pueden recuperar ---

test('recuperar todos los ocultos de una vez', async () => {
  const b = makeBoard();
  const keys = free.slice(0, 3).map((x) => x.key);
  await b.onMessage({ type: 'hide', keys });
  assert.strictEqual(b.hidden.size, 3);
  await b.onMessage({ type: 'unhideAll' });
  assert.strictEqual(b.hidden.size, 0);
  for (const k of keys) assert.ok(b.looseTiles().some((x) => x.key === k), 'no volvio ' + k);
});

test('el tablero informa de cuantos hay ocultos', async () => {
  const b = makeBoard();
  b.render();
  assert.strictEqual(b.last().hiddenCount, 0);
  await b.onMessage({ type: 'hide', keys: [free[0].key] });
  assert.strictEqual(b.last().hiddenCount, 1, 'sin este numero el usuario no sabe que hay ocultos');
});

test('el chat y demas piezas del propio VS Code aparecen como iconos', () => {
  for (const [key, cmd] of CORE) {
    const tile = tiles.find((x) => x.key === key);
    assert.ok(tile, 'falta ' + key);
    assert.strictEqual(tile.cmd, cmd);
    assert.ok(tile.icon, key + ' se quedo sin dibujo');
  }
  // Y si esta instalacion no los tiene, el filtro por comandos registrados los quita.
  assert.ok(tiles.some((x) => x.key === 'k:chat'));
});

// --- el tablero = exactamente los iconos de las dos barras laterales ---

/** Lo que los manifiestos instalados declaran, agrupado por ubicacion. */
function declared() {
  const out = { sidebar: new Set(), panel: new Set() };
  for (const ext of installed) {
    if (ext.id === 'niko.view-groups') continue;      // el tablero no se lista a si mismo
    for (const [where, list] of Object.entries((ext.packageJSON.contributes || {}).viewsContainers || {})) {
      for (const vc of list || []) {
        if (!vc || !vc.id) continue;
        (/^(activitybar|secondarysidebar|auxiliarybar)$/i.test(where) ? out.sidebar : out.panel).add('c:' + vc.id);
      }
    }
  }
  return out;
}

test('estan todos los contenedores que VS Code si pinta en las barras', () => {
  const { sidebar } = declared();
  assert.ok(sidebar.size > 5, 'el escenario de prueba no tiene suficientes contenedores');
  // Los que VS Code oculta por no tener ninguna vista visible no cuentan como ausencias.
  const visibles = [...sidebar].filter((k) => {
    if (DEV_CONTAINERS.has(k.slice(2))) return false;        // los de depuracion nunca salen
    for (const ext of installed) {
      const c = ext.packageJSON.contributes || {};
      const vs = (c.views || {})[k.slice(2)];
      if (vs !== undefined) return containerShows(vs);
    }
    return false;
  });
  const faltan = visibles.filter((k) => !tiles.some((x) => x.key === k));
  assert.deepStrictEqual(faltan, [], 'faltan iconos que si estan en las barras');
});

test('se descarta lo que VS Code no pinta en la barra', () => {
  // Jupyter no declara ninguna vista en su contenedor: en la barra real no aparece.
  assert.ok(!tiles.some((x) => x.key === 'c:emptyView'), 'se colo un contenedor sin vistas');
  assert.strictEqual(containerShows(undefined), false);
  assert.strictEqual(containerShows([]), false);
  assert.strictEqual(containerShows([{ id: 'a', when: 'config.acme.showPanel' }]), false);
  assert.strictEqual(containerShows([{ id: 'a' }]), true);
  // Si la condicion depende de otra extension, no se puede saber: se muestra.
  assert.strictEqual(containerShows([{ id: 'a', when: 'gradle:activated' }]), true);
});

test('evalua las clausulas when que puede y admite no saber', () => {
  assert.strictEqual(whenValue(''), true);
  assert.strictEqual(whenValue('config.acme.showPanel'), false);
  assert.strictEqual(whenValue('!config.acme.showPanel'), true);
  assert.strictEqual(whenValue('config.acme.showPanel != false'), false);
  assert.strictEqual(whenValue('config.acme.showPanel == false'), true);
  assert.strictEqual(whenValue('cmake:enableFullFeatureSet'), null, 'una context key ajena no se puede saber');
  assert.strictEqual(whenValue('config.acme.showPanel && cmake:x'), false, 'basta un falso');
  assert.strictEqual(whenValue('cmake:x && cmake:y'), null);
  assert.strictEqual(whenValue('!config.acme.showPanel || cmake:x'), true, 'basta un cierto');
  assert.strictEqual(whenValue('config.no.existe'), null, 'un ajuste inexistente no se inventa');
});

test('no se cuela nada del panel de abajo', () => {
  const { panel, sidebar } = declared();
  const colados = [...panel].filter((k) => !sidebar.has(k) && tiles.some((x) => x.key === k));
  assert.ok(panel.size > 0, 'el escenario no tiene contenedores de panel');
  assert.deepStrictEqual(colados, [], 'el panel inferior no es una barra lateral');
});

test('las secciones no salen como iconos aparte', () => {
  // Son partes de un contenedor, no iconos de la barra: el tablero refleja la barra.
  assert.deepStrictEqual(tiles.filter((x) => x.key.startsWith('v:')).map((x) => x.key), []);
});

test('cada baldosa es un nativo, un contenedor de barra o una pieza propia de VS Code', () => {
  const raras = tiles.filter((x) => !/^(n|c|k):/.test(x.key));
  assert.deepStrictEqual(raras.map((x) => x.key), []);
});

test('cada extension aporta un icono por contenedor de barra, y ninguno del panel', () => {
  assert.deepStrictEqual(tiles.filter((x) => x.ext === 'acme.tasks').map((x) => x.key),
    ['c:tasksView', 'c:tasksSecondary']);
  assert.deepStrictEqual(tiles.filter((x) => x.ext === 'acme.bottom').map((x) => x.key), []);
});
test('el chat solo se anade si nadie mas lo aporta', () => {
  assert.ok(tiles.some((x) => x.key === 'k:chat'), 'falta el chat');
  // Si una extension ya trajera ese mismo comando, no se duplica.
  const dup = tiles.filter((x) => x.cmd === 'workbench.action.chat.open');
  assert.strictEqual(dup.length, 1);
});

test('el bloque nativo va siempre el primero', () => {
  const b = makeBoard({ 'viewGroups.folders': [
    { name: 'IAs', keys: ['c:algo'] },
    { name: 'Native', keys: NATIVE_KEYS, locked: true },
    { name: 'Hardware', keys: [] },
  ] });
  assert.deepStrictEqual(b.folders.map((f) => f.name), ['Native', 'IAs', 'Hardware']);
  b.render();
  assert.strictEqual(b.last().folders[0].name, 'Native', 'no se pinta arriba del todo');
});

test('recien creado, el bloque nativo tambien nace arriba', async () => {
  const b = makeBoard();
  await b.seed();
  assert.strictEqual(b.folders[0].locked, true);
});

test('ninguna carpeta puede colocarse por encima del bloque nativo', async () => {
  const b = makeBoard({ 'viewGroups.folders': [
    { name: 'Native', keys: NATIVE_KEYS, locked: true },
    { name: 'IAs', keys: [] },
  ] });
  await b.onMessage({ type: 'reorder', folder: 'IAs', before: 'Native' });
  assert.deepStrictEqual(b.folders.map((f) => f.name), ['Native', 'IAs']);
});

test('una carpeta nueva se crea debajo del bloque nativo', async () => {
  const b = makeBoard();
  await b.seed();
  inputAnswer = 'IAs';
  await b.newFolder();
  assert.deepStrictEqual(b.folders.map((f) => f.locked === true), [true, false]);
});

// --- el icono de chat apunta al comando mas concreto que exista ---

test('si existe un comando propio de Copilot, el chat lo usa', () => {
  const copia = discover(CTX);
  refineChat(copia, new Set(['workbench.action.chat.open', 'workbench.panel.chat.view.copilot.focus']));
  assert.strictEqual(copia.find((x) => x.key === 'k:chat').cmd, 'workbench.panel.chat.view.copilot.focus');
});

test('sin comando propio, el chat se queda con el generico', () => {
  const copia = discover(CTX);
  refineChat(copia, new Set(['workbench.action.chat.open']));
  assert.strictEqual(copia.find((x) => x.key === 'k:chat').cmd, 'workbench.action.chat.open');
});

test('se respeta el orden de preferencia entre variantes', () => {
  const copia = discover(CTX);
  refineChat(copia, new Set([
    'workbench.action.chat.open',
    'github.copilot.chat.focus',
    'workbench.panel.chat.view.copilot.focus',
  ]));
  assert.strictEqual(copia.find((x) => x.key === 'k:chat').cmd, 'workbench.panel.chat.view.copilot.focus');
});

test('los contenedores de depuracion de Copilot no salen', () => {
  // "Chat Debug" y "Language Context Inspector" viven detras de ajustes apagados:
  // en la barra real no estan, y aqui solo serian dos clics que no hacen nada.
  for (const id of DEV_CONTAINERS) {
    assert.ok(!tiles.some((x) => x.key === 'c:' + id), 'se colo ' + id);
  }
});

// --- extensiones apagadas ---

/**
 * Board con los comandos interceptados y control sobre que extensiones "existen".
 * Apagar una extension se simula quitandola de vscode.extensions.all, que es exactamente
 * lo que hace VS Code tras deshabilitarla y recargar.
 */
function switchBoard(comandos, initial) {
  const b = makeBoard(initial);
  b.ejecutados = [];
  const realExec = stub.commands.executeCommand, realCmds = stub.commands.getCommands, realAll = stub.extensions.all;
  // La lista de comandos no se usa para filtrar aqui: si se pasara `comandos`, keepClickable
  // dejaria el tablero vacio y no habria baldosas sobre las que probar nada.
  stub.commands.getCommands = async () => null;
  stub.commands.executeCommand = async (c, arg) => {
    b.ejecutados.push([c, arg]);
    if (comandos && !comandos.includes(c)) throw new Error('comando desconocido');
  };
  b.desactivar = (id) => { stub.extensions.all = stub.extensions.all.filter((e) => e.id !== id); };
  b.reactivar = () => { stub.extensions.all = realAll; };
  b.restore = () => {
    stub.commands.executeCommand = realExec;
    stub.commands.getCommands = realCmds;
    stub.extensions.all = realAll;
  };
  return b;
}

test('marcar una extension la mete en la lista, con su identificador', async () => {
  const b = switchBoard(['extension.open']);
  await b.refresh();
  await b.toggleQueued('c:buildView');
  assert.deepStrictEqual(b.queue, [{ key: 'c:buildView', ext: 'acme.build', action: 'disable' }]);
  b.restore();
});

test('volver a marcarla la saca de la lista', async () => {
  const b = switchBoard(['extension.open']);
  await b.refresh();
  await b.toggleQueued('c:buildView');
  await b.toggleQueued('c:buildView');
  assert.deepStrictEqual(b.queue, []);
  b.restore();
});

test('marcar no apaga nada todavia: hasta aplicar, sigue cargandose', async () => {
  // El fallo de las versiones 0.23-0.26 era justo este: pintar en gris por intencion.
  const b = switchBoard(['extension.open']);
  await b.refresh();
  await b.toggleQueued('c:buildView');
  await b.refresh();
  const tile = b.tiles.find((x) => x.key === 'c:buildView');
  assert.ok(!tile.off, 'seguia cargandose y aun asi se pintaba apagada');
  assert.deepStrictEqual(b.off, []);
  assert.deepStrictEqual(b.ejecutados, [], 'no deberia ejecutar nada al marcar');
  b.restore();
});

test('una apagada se marca para encender, no para apagar', async () => {
  const b = switchBoard(['extension.open']);
  await b.refresh();
  b.desactivar('acme.build');
  await b.refresh();
  await b.toggleQueued('c:buildView');
  assert.strictEqual(b.queue[0].action, 'enable');
  b.restore();
});

test('vaciar la lista la deja limpia sin tocar ninguna extension', async () => {
  const b = switchBoard(['extension.open']);
  await b.refresh();
  await b.toggleQueued('c:buildView');
  await b.toggleQueued('c:notesView');
  await b.clearQueue();
  assert.deepStrictEqual(b.queue, []);
  assert.deepStrictEqual(b.ejecutados, []);
  b.restore();
});

test('la lista sobrevive a un refresco: se marca ahora y se aplica luego', async () => {
  const b = switchBoard(['extension.open']);
  await b.refresh();
  await b.toggleQueued('c:buildView');
  await b.refresh();
  assert.strictEqual(b.queue.length, 1);
  assert.strictEqual(b.last().queueCount, 1, 'el boton no sabria que hay algo pendiente');
  b.restore();
});

test('una entrada corrompida no llega a la orden que se ejecuta', async () => {
  const b = switchBoard(['extension.open'],
    { 'viewGroups.queue': ['basura', { key: 1 }, { key: 'a', ext: 'b', action: 'boom' }] });
  await b.refresh();
  assert.deepStrictEqual(b.queue, []);
  b.restore();
});

test('una extension que VS Code deja de cargar aparece apagada', async () => {
  const b = switchBoard(['extension.open']);
  await b.refresh();                                          // queda en el catalogo
  b.desactivar('acme.build');                                 // el usuario la deshabilito y recargo
  await b.refresh();
  const tile = b.tiles.find((x) => x.key === 'c:buildView');
  assert.ok(tile, 'se perdio: no habria forma de volver a encenderla');
  assert.strictEqual(tile.off, true);
  assert.strictEqual(tile.label, 'Build', 'deberia conservar su nombre');
  assert.ok(tile.icon, 'deberia conservar su icono');
  b.restore();
});

test('da igual si se apago desde el tablero o desde la vista de extensiones', async () => {
  // El estado se deduce del hecho, no de la intencion, asi que ambos caminos se ven igual.
  const b = switchBoard(['extension.open']);
  await b.refresh();
  b.desactivar('acme.notes');
  await b.refresh();
  assert.deepStrictEqual(b.off.map((o) => o.key), ['c:notesView']);
  b.restore();
});

test('al volver a cargarse recupera su sitio y deja de estar en gris', async () => {
  const b = switchBoard(['extension.open']);
  await b.refresh();
  b.desactivar('acme.build');
  await b.refresh();
  assert.strictEqual(b.tiles.find((x) => x.key === 'c:buildView').off, true);
  b.reactivar();
  await b.refresh();
  assert.ok(!b.tiles.find((x) => x.key === 'c:buildView').off);
  assert.deepStrictEqual(b.off, []);
  b.restore();
});

test('pulsar una apagada la marca para encenderla', async () => {
  const b = switchBoard(['extension.open']);
  await b.refresh();
  b.desactivar('acme.build');
  await b.refresh();
  b.ejecutados.length = 0;
  await b.open('c:buildView');
  assert.strictEqual(b.queue[0].action, 'enable');
  assert.deepStrictEqual(b.ejecutados, [], 'no deberia intentar abrir el panel de una apagada');
  b.restore();
});

test('se puede quitar del tablero una apagada que ya no interesa', async () => {
  const b = switchBoard(['extension.open']);
  await b.refresh();
  b.desactivar('acme.build');
  await b.refresh();
  await b.forget('c:buildView');
  assert.ok(!b.tiles.some((x) => x.key === 'c:buildView'), 'seguia ahi');
  assert.deepStrictEqual(b.off, []);
  b.restore();
});

test('ni los iconos de fabrica ni el propio tablero entran en la lista', async () => {
  const b = switchBoard(['extension.open']);
  await b.refresh();
  for (const k of [...NATIVE_KEYS, 'k:chat', 'c:viewGroups']) await b.toggleQueued(k);
  assert.deepStrictEqual(b.queue, [], 'apagar el propio tablero lo dejaria sin forma de volver');
  b.restore();
});

test('el catalogo no guarda los iconos de fabrica', async () => {
  const b = switchBoard(['extension.open']);
  await b.refresh();
  assert.deepStrictEqual(b.seen.filter((o) => o.ext === 'vscode'), []);
  b.restore();
});

test('el estado mentiroso de la version anterior se descarta al arrancar', async () => {
  // 0.23–0.26 anotaban "apagada" por intencion: extensiones cargadas salian en gris.
  const b = switchBoard(['extension.open'], {
    'viewGroups.off': [{ ext: 'acme.build', key: 'c:buildView', label: 'Build' }],
  });
  await b.refresh();
  assert.strictEqual(b.store.get('viewGroups.off'), undefined, 'no se limpio');
  assert.ok(!b.tiles.find((x) => x.key === 'c:buildView').off, 'seguia mintiendo');
  b.restore();
});

// --- correcciones de la revision ---

test('el webview recibe la marca de apagada', async () => {
  const b = switchBoard(['extension.open']);
  await b.refresh();
  b.desactivar('acme.build');
  await b.refresh();
  const pintadas = b.last().loose.concat(b.last().folders.flatMap((f) => f.tiles));
  assert.strictEqual(pintadas.find((x) => x.key === 'c:buildView').off, true);
  b.restore();
});

test('marcar una baldosa que ya no existe no rompe nada', async () => {
  const b = switchBoard([]);                                  // ningun comando responde
  await b.refresh();
  await b.toggleQueued('c:noExiste');
  assert.deepStrictEqual(b.queue, []);
  b.restore();
});

test('el catalogo no duplica entradas al refrescar muchas veces', async () => {
  const b = switchBoard(['extension.open']);
  await b.refresh();
  await b.refresh();
  await b.refresh();
  const claves = b.seen.map((o) => o.key);
  assert.strictEqual(new Set(claves).size, claves.length);
  b.restore();
});

test('el anclaje del arranque no molesta si no se puede', async () => {
  const b = dockBoard(['viewGroups.board.focus']);            // sin comando de mover
  infos.length = 0;
  await b.autoDock();
  assert.strictEqual(infos.length, 0, 'no debe dar la lata al arrancar');
  b.restore();
});

// --- iconos: se comprueba que el archivo exista antes de usarlo ---

test('si el logo del marketplace no esta, se pasa al icono de la barra', () => {
  const base = { fsPath: path.join(ROOT, 'media') };
  // 'no-existe.png' no esta; 'codicons/key.svg' si.
  const icono = mod.exports.pickIcon
    ? mod.exports.pickIcon(CTX, base, 'no-existe.png', 'codicons/key.svg')
    : null;
  assert.ok(icono, 'no cayo al siguiente candidato');
  assert.ok(icono.uri.fsPath.endsWith('key.svg'));
  assert.strictEqual(icono.mask, true);
});

test('sin ningun archivo valido se queda sin icono, y sale la inicial', () => {
  const base = { fsPath: path.join(ROOT, 'media') };
  assert.strictEqual(mod.exports.pickIcon(CTX, base, 'no-existe.png', 'tampoco.svg'), null);
});

test('el icono claro sirve de reserva si falta el oscuro', () => {
  const base = { fsPath: path.join(ROOT, 'media') };
  const icono = mod.exports.pickIcon(CTX, base, null, { dark: 'no-existe.svg', light: 'codicons/key.svg' });
  assert.ok(icono && icono.uri.fsPath.endsWith('key.svg'));
});

test('todas las baldosas reales apuntan a un archivo que existe', () => {
  const rotos = tiles.filter((x) => x.icon && !fs.existsSync(x.icon.uri.fsPath));
  assert.deepStrictEqual(rotos.map((x) => x.label + ' -> ' + x.icon.uri.fsPath), []);
});

test('un logo de marketplace en png se muestra tal cual', () => {
  const c = tiles.find((x) => x.key === 'c:notesView');
  assert.ok(c && c.icon, 'se quedo sin dibujo');
  assert.ok(fs.existsSync(c.icon.uri.fsPath));
  assert.strictEqual(c.icon.mask, false, 'un png no debe pintarse como silueta');
});

// --- comprobacion automatica ---

test('la comprobacion no encuentra problemas en un estado sano', async () => {
  const b = switchBoard(null);
  await b.refresh();
  stub.commands.getCommands = async () => b.tiles.map((x) => x.cmd);
  const fallos = await b.selfTest(null);
  assert.deepStrictEqual(fallos, []);
  b.restore();
});

test('la comprobacion detecta un comando que no existe', async () => {
  const b = switchBoard(null);
  await b.refresh();
  stub.commands.getCommands = async () => ['solo.uno'];
  const fallos = await b.selfTest(null);
  assert.ok(fallos.length > 0, 'no vio los comandos muertos');
  assert.ok(fallos.every((f) => /comando no existe/.test(f)));
  b.restore();
});

test('la comprobacion detecta un icono perdido', async () => {
  const b = switchBoard(null);
  await b.refresh();
  stub.commands.getCommands = async () => b.tiles.map((x) => x.cmd);
  b.tiles[0].icon = { uri: { fsPath: path.join(ROOT, 'no-existe.png') }, mask: false };
  const fallos = await b.selfTest(null);
  assert.ok(fallos.some((f) => /icono no esta/.test(f)), 'no vio el icono perdido');
  b.restore();
});

test('la comprobacion detecta un estado guardado incoherente', async () => {
  const b = switchBoard(null, { 'viewGroups.folders': [
    { name: 'IAs', keys: ['c:algo'] },
    { name: 'Otra', keys: ['c:algo'] },                       // el mismo icono dos veces
  ] });
  await b.refresh();
  stub.commands.getCommands = async () => b.tiles.map((x) => x.cmd);
  const fallos = await b.selfTest(null);
  assert.ok(fallos.some((f) => /dos carpetas a la vez/.test(f)));
  b.restore();
});

test('la comprobacion escribe un informe legible', async () => {
  const b = switchBoard(null);
  await b.refresh();
  stub.commands.getCommands = async () => b.tiles.map((x) => x.cmd);
  const lineas = [];
  await b.selfTest({ appendLine: (l) => lineas.push(l) });
  const texto = lineas.join('\n');
  for (const trozo of ['idioma:', 'baldosas:', 'comandos:', 'python:', 'en la lista, sin aplicar:',
    'ultimo intento de aplicar:', 'carpetas:']) {
    assert.ok(texto.includes(trozo), 'falta la seccion ' + trozo);
  }
  b.restore();
});

// --- las apagadas se van al final ---

test('una apagada baja al final de la lista', async () => {
  const b = switchBoard(['extension.open']);
  await b.refresh();
  const antes = b.looseTiles().map((x) => x.key);
  b.desactivar('acme.build');
  await b.refresh();
  const despues = b.looseTiles().map((x) => x.key);
  assert.strictEqual(despues[despues.length - 1], 'c:buildView', 'no se fue al fondo');
  assert.deepStrictEqual(despues.filter((k) => k !== 'c:buildView'), antes.filter((k) => k !== 'c:buildView'),
    'las demas deben quedarse donde estaban');
  b.restore();
});

test('entre apagadas mandan las letras, no el orden manual', async () => {
  const b = switchBoard(['extension.open']);
  await b.refresh();
  const sueltas = b.looseTiles().filter((x) => !x.native).slice(0, 3).map((x) => x.key);
  // Se colocan a mano en orden inverso y luego VS Code deja de cargarlas.
  await b.onMessage({ type: 'move', keys: [sueltas[2]], before: sueltas[0] });
  for (const k of sueltas) b.desactivar(b.tiles.find((x) => x.key === k).ext);
  await b.refresh();
  const apagadas = b.looseTiles().filter((x) => x.off);
  const nombres = apagadas.map((x) => b.nameOf(x));
  assert.deepStrictEqual(nombres, [...nombres].sort((x, y) => x.localeCompare(y)));
  b.restore();
});

test('dentro de una carpeta tambien baja al fondo', async () => {
  const b = switchBoard(['extension.open']);
  await b.refresh();
  const dentro = ['c:notesView', 'c:buildView', 'c:keysView'];
  b.store.set('viewGroups.folders', [{ name: 'A', keys: dentro }]);
  b.desactivar('acme.build');
  await b.refresh();
  const carpeta = b.last().folders.find((f) => f.name === 'A');
  assert.strictEqual(carpeta.tiles[carpeta.tiles.length - 1].key, 'c:buildView');
  assert.deepStrictEqual(carpeta.tiles.slice(0, 2).map((x) => x.key), ['c:notesView', 'c:keysView'],
    'las encendidas conservan su orden');
  b.restore();
});

test('al volver a cargarse recupera su orden alfabetico', async () => {
  const b = switchBoard(['extension.open']);
  await b.refresh();
  const sitio = b.looseTiles().findIndex((x) => x.key === 'c:buildView');
  b.desactivar('acme.build');
  await b.refresh();
  assert.strictEqual(b.looseTiles().pop().key, 'c:buildView');
  b.reactivar();
  await b.refresh();
  assert.strictEqual(b.looseTiles().findIndex((x) => x.key === 'c:buildView'), sitio);
  b.restore();
});

test('una extension con dos iconos los apaga los dos', async () => {
  const b = switchBoard(['extension.open']);
  await b.refresh();
  assert.ok(b.tiles.filter((x) => x.ext === 'acme.tasks').length >= 2, 'falta la pieza de prueba');
  b.desactivar('acme.tasks');
  await b.refresh();
  const suyos = b.tiles.filter((x) => x.ext === 'acme.tasks');
  assert.ok(suyos.length >= 2 && suyos.every((x) => x.off), 'quedo alguno encendido');
  b.restore();
});

test('Pruebas y Explorador remoto salen: son iconos de barra que VS Code monta por su cuenta', () => {
  // No estan en ningun manifiesto, pero si en la barra real. Como el chat.
  for (const key of ['k:testing', 'k:remote']) {
    const tile = tiles.find((x) => x.key === key);
    assert.ok(tile, 'falta ' + key);
    assert.ok(tile.icon, key + ' se quedo sin dibujo');
  }
});

test('si esta instalacion no los registra, desaparecen solos', async () => {
  const registrados = tiles.filter((x) => x.key !== 'k:testing').map((x) => x.cmd);
  const real = stub.commands.getCommands;
  stub.commands.getCommands = async () => registrados;
  const kept = await keepClickable(discover(CTX));
  assert.ok(!kept.some((x) => x.key === 'k:testing'));
  stub.commands.getCommands = real;
});

// --- desinstalar: lo unico que si se puede hacer por codigo ---

test('desinstalar pide confirmacion y sin ella no toca nada', async () => {
  const b = switchBoard(['workbench.extensions.uninstallExtension']);
  await b.refresh();
  avisos.length = 0;
  warnAnswer = null;                                          // el usuario cancela
  await b.uninstall('c:buildView');
  assert.strictEqual(avisos.length, 1, 'no aviso de que borra');
  assert.ok(/desinstalar|uninstall/i.test(avisos[0]), 'el aviso no dice de que va');
  assert.deepStrictEqual(b.ejecutados, [], 'desinstalo sin permiso');
  b.restore();
});

test('al confirmar, desinstala de verdad con el comando de VS Code', async () => {
  const b = switchBoard(['workbench.extensions.uninstallExtension']);
  await b.refresh();
  warnAnswer = 'Uninstall';
  await b.uninstall('c:buildView');
  assert.deepStrictEqual(b.ejecutados, [['workbench.extensions.uninstallExtension', 'acme.build']]);
  warnAnswer = null;
  b.restore();
});

test('una desinstalada no se queda en gris esperando volver', async () => {
  // Apagada y desinstalada no son lo mismo: de la segunda no hay vuelta desde el tablero.
  const b = switchBoard(['workbench.extensions.uninstallExtension']);
  await b.refresh();
  warnAnswer = 'Uninstall';
  await b.uninstall('c:buildView');
  b.desactivar('acme.build');                                 // ya no esta en el disco
  await b.refresh();
  assert.ok(!b.tiles.some((x) => x.key === 'c:buildView'), 'quedo como si estuviera apagada');
  assert.deepStrictEqual(b.store.get('viewGroups.removed'), [], 'la marca sobra una vez desinstalada');
  assert.deepStrictEqual(b.off, []);
  warnAnswer = null;
  b.restore();
});

test('si el comando de desinstalar falla, se lleva a la ficha', async () => {
  const b = switchBoard(['extension.open']);                  // sin comando de desinstalar
  await b.refresh();
  warnAnswer = 'Uninstall';
  avisos.length = 0;
  await b.uninstall('c:buildView');
  assert.ok(b.ejecutados.some(([c]) => c === 'extension.open'), 'no ofrecio salida');
  assert.ok(b.tiles.some((x) => x.key === 'c:buildView'), 'la dio por desinstalada sin serlo');
  warnAnswer = null;
  b.restore();
});

test('ni los iconos de fabrica ni el propio tablero se desinstalan', async () => {
  const b = switchBoard(['workbench.extensions.uninstallExtension']);
  await b.refresh();
  warnAnswer = 'Uninstall';
  avisos.length = 0;
  for (const k of [...NATIVE_KEYS, 'k:chat', 'k:testing', 'c:viewGroups']) await b.uninstall(k);
  assert.deepStrictEqual(b.ejecutados, []);
  assert.strictEqual(avisos.length, 0, 'ni siquiera deberia preguntar');
  warnAnswer = null;
  b.restore();
});

// --- desactivar sin pasos manuales ---

test('la orden que se lanza lleva la lista entera, y reabre VS Code', () => {
  const plan = restartCommand({
    dir: 'C:/ext/scripts', python: 'python',
    disable: ['acme.build', 'acme.notes'], enable: ['acme.tasks'], codeExe: 'C:/Code.exe',
  });
  const todo = [plan.exe, ...plan.args].join(' ');
  for (const id of ['acme.build', 'acme.notes', 'acme.tasks']) {
    assert.ok(todo.includes(id), 'se quedo fuera de la orden: ' + id);
  }
  assert.ok(todo.includes('gg-extensions.py'), 'no llama al guion que escribe');
  assert.ok(todo.includes('C:/Code.exe'), 'no sabria como volver a abrir VS Code');
});

test('apagar y encender viajan por separado, no mezclados', () => {
  const plan = restartCommand({
    dir: 'C:/ext/scripts', python: 'python',
    disable: ['a.uno'], enable: ['b.dos'], codeExe: 'C:/Code.exe',
  });
  const todo = [plan.exe, ...plan.args].join(' ');
  // Si se cruzaran, se apagaria lo que el usuario pidio encender.
  assert.ok(!/disable\s+\S*b\.dos/.test(todo) && !/enable\s+\S*a\.uno/.test(todo));
});

test('una lista de un solo lado no arrastra la otra vacia', () => {
  const plan = restartCommand({
    dir: 'C:/ext/scripts', python: 'python', disable: ['a.uno'], enable: [], codeExe: 'C:/Code.exe',
  });
  assert.ok([plan.exe, ...plan.args].join(' ').includes('a.uno'));
});

test('en Windows la ventana se abre de verdad, no en un proceso invisible', () => {
  if (process.platform !== 'win32') return;
  const plan = restartCommand({
    dir: 'C:/ext/scripts', python: 'py', disable: ['a.b'], enable: [], codeExe: 'C:/Code.exe',
  });
  // Lanzar powershell.exe con detached deja al proceso sin consola: corre invisible y sus
  // avisos no los ve nadie. Fue exactamente el fallo del primer intento.
  assert.strictEqual(plan.exe, 'cmd.exe');
  assert.deepStrictEqual(plan.args.slice(0, 3), ['/c', 'start', 'GG Groups']);
  assert.ok(plan.args.includes('powershell.exe'));
  assert.ok(plan.args.some((a) => a.endsWith('gg-apply.ps1')), 'no usa el guion de espera');
  // Sin perfil ni politica heredada: no debe depender de como tenga el equipo cada uno.
  assert.ok(plan.args.includes('-NoProfile'), 'deberia ignorar el perfil del usuario');
  assert.ok(plan.args.includes('-ExecutionPolicy') && plan.args.includes('Bypass'),
    'sin esto fallaria en equipos con la politica restringida');
});

test('no se pasan listas vacias como argumento suelto', () => {
  if (process.platform !== 'win32') return;
  const plan = restartCommand({
    dir: 'C:/ext/scripts', python: 'py', disable: ['a.b'], enable: [], codeExe: 'C:/Code.exe',
  });
  // Un "" viajando por cmd se pierde o corre los demas parametros de sitio.
  assert.ok(plan.args.includes('-Disable'));
  assert.ok(!plan.args.includes('-Enable'), 'la lista vacia no deberia ni aparecer');
  assert.ok(!plan.args.includes(''), 'un argumento vacio a traves de cmd desalinea el resto');
});

test('el proceso de fuera deja registro de lo que hizo', () => {
  const plan = restartCommand({
    dir: 'C:/ext/scripts', python: 'py', disable: ['a.b'], enable: [],
    codeExe: 'C:/Code.exe', log: 'C:/estado/gg-apply.log',
  });
  assert.ok([plan.exe, ...plan.args].join(' ').includes('gg-apply.log'),
    'sin registro, un fallo ahi fuera es invisible desde VS Code');
});

test('el guion de espera no escribe si VS Code sigue abierto', () => {
  const ps = fs.readFileSync(path.join(ROOT, 'scripts', 'gg-apply.ps1'), 'utf8');
  assert.ok(/Get-Process\s+-Name\s+'Code'/.test(ps), 'no comprueba si sigue abierto');
  assert.ok(/\$Disable/.test(ps) && /\$Enable/.test(ps), 'no acepta las dos listas');
  assert.ok(/exit 1/.test(ps), 'no se rinde cuando sigue abierto');
  // Si VS Code reaparece mientras espera, vuelve a esperar en vez de rendirse callado.
  assert.ok(/\$avisado = \$false; continue/.test(ps), 'no reintenta si VS Code vuelve');
  assert.ok(/--force/.test(ps), 'el guion volveria a comprobar lo ya comprobado y no escribiria');
  assert.ok(/ReadKey/.test(ps), 'la ventana se cerraria sin que diera tiempo a leer el fallo');
  assert.ok(/Start-Process\s+-FilePath\s+\$CodeExe/.test(ps), 'no lo vuelve a abrir');
  assert.ok(/TimeoutSeconds/.test(ps), 'esperaria para siempre si nadie cierra');
});

test('sin Python no se finge: se cae a copiar la orden de toda la lista', async () => {
  const b = switchBoard(['extension.open']);
  await b.refresh();
  await b.toggleQueued('c:buildView');
  await b.toggleQueued('c:notesView');
  const copiado = [];
  const realEnv = stub.env;
  stub.env = { language: 'en', clipboard: { writeText: async (x) => copiado.push(x) } };
  await b.copyScript();
  assert.ok(copiado[0], 'no copio nada');
  assert.ok(copiado[0].includes('acme.build') && copiado[0].includes('acme.notes'),
    'la orden copiada dejaria fuera parte de la lista');
  assert.ok(copiado[0].includes('disable'));
  stub.env = realEnv;
  b.restore();
});

// --- acciones sobre varios iconos a la vez ---

test('el interruptor de grupo marca todo lo seleccionado de una vez', async () => {
  const b = switchBoard(['extension.open']);
  await b.refresh();
  await b.toggleQueuedMany(['c:buildView', 'c:notesView'], 'disable');
  assert.deepStrictEqual(b.queue.map((o) => o.ext).sort(), ['acme.build', 'acme.notes']);
  assert.ok(b.queue.every((o) => o.action === 'disable'));
  b.restore();
});

test('marcar un grupo no alterna: lo pedido es lo que se aplica a todos', async () => {
  // Alternar uno por uno dejaria la mitad marcada al reves de lo que se pidio.
  const b = switchBoard(['extension.open']);
  await b.refresh();
  await b.toggleQueued('c:buildView');
  await b.toggleQueuedMany(['c:buildView', 'c:notesView'], 'disable');
  assert.strictEqual(b.queue.length, 2, 'la ya marcada se desmarco sola');
  assert.ok(b.queue.every((o) => o.action === 'disable'));
  b.restore();
});

test('pedir apagar lo ya apagado no mete nada en la lista', async () => {
  const b = switchBoard(['extension.open']);
  await b.refresh();
  b.desactivar('acme.build');
  await b.refresh();
  await b.toggleQueuedMany(['c:buildView'], 'disable');
  assert.deepStrictEqual(b.queue, []);
  await b.toggleQueuedMany(['c:buildView'], 'enable');
  assert.strictEqual(b.queue.length, 1);
  b.restore();
});

test('el grupo no arrastra ni los nativos ni el propio tablero', async () => {
  const b = switchBoard(['extension.open']);
  await b.refresh();
  await b.toggleQueuedMany([...NATIVE_KEYS, 'c:viewGroups', 'c:buildView'], 'disable');
  assert.deepStrictEqual(b.queue.map((o) => o.ext), ['acme.build']);
  b.restore();
});

test('desinstalar un grupo pide una sola confirmacion y sin ella no toca nada', async () => {
  const b = switchBoard(['workbench.extensions.uninstallExtension']);
  await b.refresh();
  avisos.length = 0;
  warnAnswer = null;
  await b.uninstallMany(['c:buildView', 'c:notesView']);
  assert.strictEqual(avisos.length, 1, 'deberia preguntar una vez, no una por extension');
  assert.deepStrictEqual(b.ejecutados, [], 'desinstalo sin permiso');
  b.restore();
});

test('al confirmar, desinstala cada extension una sola vez', async () => {
  const b = switchBoard(['workbench.extensions.uninstallExtension']);
  await b.refresh();
  warnAnswer = 'Uninstall';
  // acme.tasks aporta dos baldosas: la extension es una, y una vez debe desinstalarse.
  const suyas = b.tiles.filter((x) => x.ext === 'acme.tasks').map((x) => x.key);
  assert.ok(suyas.length >= 2, 'falta la pieza de prueba');
  await b.uninstallMany([...suyas, 'c:buildView']);
  const pedidas = b.ejecutados.filter((c) => c[0] === 'workbench.extensions.uninstallExtension');
  assert.deepStrictEqual(pedidas.map((c) => c[1]).sort(), ['acme.build', 'acme.tasks']);
  warnAnswer = null;
  b.restore();
});

test('al pedir el webview su estado, se le manda', async () => {
  const b = makeBoard();
  await b.refresh();
  b.posted.length = 0;
  await b.onMessage({ type: 'ready' });
  assert.strictEqual(b.last().type, 'state');
  assert.ok(b.last().folders.length, 'le llegaria un tablero vacio');
});

test('si todavia no hay baldosas, primero se descubren', async () => {
  const b = makeBoard();
  b.posted.length = 0;
  b.tiles = [];                        // la vista se resolvio antes del primer refresco
  await b.onMessage({ type: 'ready' });
  assert.ok(b.tiles.length, 'se quedaria en negro hasta el primer refresco');
  assert.strictEqual(b.last().type, 'state');
});

test('marcar lleva derecho a la confirmacion de aplicar', async () => {
  // Marcar y callarse se vive como que el boton no hizo nada.
  const b = switchBoard(['extension.open']);
  await b.refresh();
  avisos.length = 0;
  warnAnswer = null;                                          // el usuario cancela
  await b.toggleQueuedMany(['c:buildView', 'c:notesView'], 'disable');
  assert.strictEqual(avisos.length, 1, 'marco sin preguntar nada');
  assert.ok(/2/.test(avisos[0]), 'no dice cuantos cambios va a aplicar');
  b.restore();
});

test('cancelar deja lo marcado en su sitio', async () => {
  const b = switchBoard(['extension.open']);
  await b.refresh();
  warnAnswer = null;
  await b.toggleQueuedMany(['c:buildView', 'c:notesView'], 'disable');
  assert.strictEqual(b.queue.length, 2, 'cancelar no deberia perder lo elegido');
  b.restore();
});

test('quitar de la lista no pregunta nada', async () => {
  const b = switchBoard(['extension.open']);
  await b.refresh();
  warnAnswer = null;
  await b.toggleQueued('c:buildView');
  avisos.length = 0;
  await b.toggleQueued('c:buildView');
  assert.deepStrictEqual(avisos, [], 'desmarcar no necesita ceremonia');
  assert.deepStrictEqual(b.queue, []);
  b.restore();
});

test('el logo de una apagada se puede seguir cargando', async () => {
  // Al apagarla desaparece de extensions.all, y su carpeta se quedaba fuera de los
  // permisos del webview: el archivo no cargaba y el icono caia a la inicial.
  const b = switchBoard(['extension.open']);
  await b.refresh();
  const antes = b.tiles.find((x) => x.key === 'c:buildView');
  assert.ok(antes && antes.icon, 'falta la pieza de prueba: esa baldosa deberia traer icono');
  b.desactivar('acme.build');
  await b.refresh();
  const permisos = b.roots().map((u) => String(u.fsPath || u));
  const suyo = b.tiles.find((x) => x.key === 'c:buildView').icon.uri.fsPath;
  assert.ok(permisos.some((raiz) => suyo.startsWith(raiz)),
    'su carpeta no esta permitida: el webview no podria pintar el logo');
  b.restore();
});

test('el guion desactiva tambien las que trae VS Code de fabrica', () => {
  // References, Emmet y demas no estan en la carpeta del usuario y no tienen uuid:
  // exigirlas en el catalogo las saltaba en silencio.
  const py = fs.readFileSync(path.join(ROOT, 'scripts', 'gg-extensions.py'), 'utf8');
  assert.ok(/integrada en VS Code/.test(py), 'no contempla las integradas');
  assert.ok(/nueva\.append\(\{'id': i\}\)/.test(py), 'no las escribe solo con el id');
  assert.ok(!/no instalada, se omite/.test(py), 'sigue saltandoselas');
});
