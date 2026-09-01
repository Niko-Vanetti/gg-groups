// El webview de verdad (media/board.js) corriendo en un DOM, que es donde fallaba antes.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'media', 'board.js'), 'utf8');
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const STR = {
  newFolder: 'Crear carpeta', refresh: 'Actualizar',
  rename: 'Cambiar nombre', remove: 'Sacar de la carpeta', del: 'Eliminar carpeta',
  hint: 'Arrastra un icono sobre otro', sort: 'Ordenar A-Z', sortAll: 'Ordenar todo A-Z',
  renameTile: 'Cambiar nombre del icono', resetName: 'Usar el nombre original',
  hide: 'Ocultar icono', unhide: 'Mostrar icono',
  showHiddenOn: 'Ver ocultos', showHiddenOff: 'Dejar de ver ocultos',
  pickFirst: 'Alt+clic para elegir varios', mixedPick: 'Hay de los dos tipos mezclados',
  disableSel: 'Desactivar los elegidos', enableSel: 'Activar los elegidos',
  uninstallSel: 'Desinstalar los elegidos',
  unhideAll: 'Recuperar todos los ocultos',
  disable: 'Desactivar la extension', enable: 'Activar la extension', forget: 'Quitar del tablero',
  uninstall: 'Desinstalar la extension',
};

/** Monta el webview igual que lo monta la extension y devuelve utilidades para toquetearlo. */
function mount(state) {
  const dom = new JSDOM(
    `<body><div id="brand"><img><span>GG Groups</span></div>` +
    `<div id="rail"><div id="items"></div><div id="actions"></div></div><div id="hint"></div></body>`,
    { runScripts: 'outside-only', pretendToBeVisual: true }
  );
  const { window } = dom;
  const posted = [];
  let saved = null;
  window.acquireVsCodeApi = () => ({
    postMessage: (m) => posted.push(m),
    getState: () => saved,
    setState: (s) => { saved = s; },
  });
  window.STR = STR;
  // Los mismos nombres de codicon que sirve la extension, con una ruta de mentira.
  window.ICONS = {};
  for (const n of ['new-folder', 'list-ordered', 'eye', 'eye-closed', 'debug-pause',
                   'play', 'trash', 'check-all', 'refresh']) {
    window.ICONS[n] = 'vsc://codicons/' + n + '.svg';
  }
  window.eval(SRC);
  // El saludo del arranque no es una accion del usuario: se aparta para que las pruebas
  // que cuentan mensajes sigan contando lo que les importa.
  const saludo = posted.splice(0);

  const api = {
    saludo,
    window,
    doc: window.document,
    posted,
    // Los objetos nacidos dentro de jsdom tienen otro prototipo: se comparan por valor.
    get saved() { return plain(saved); },
    last: () => plain(posted[posted.length - 1]),
    send: (data) => window.dispatchEvent(new window.MessageEvent('message', { data })),
    cells: () => [...window.document.querySelectorAll('#items .cell:not(.folder):not(.stack)')],
    stacks: () => [...window.document.querySelectorAll('#items .cell.stack')],
    folders: () => [...window.document.querySelectorAll('#items .cell.folder')],
    actions: () => [...window.document.querySelectorAll('#actions .cell')],
    board: () => window.__board,
    ev: () => ({ preventDefault() {}, stopPropagation() {}, clientX: 10, clientY: 10, dataTransfer: { setData() {} } }),
    // Arrastra el nodo `from` y lo suelta sobre `to`.
    dragTo(from, to) {
      from.ondragstart(this.ev());
      to.ondragover(this.ev());
      to.ondrop(this.ev());
      from.ondragend(this.ev());
    },
  };
  if (state) api.send({ type: 'state', folders: [], loose: [], ...state });
  return api;
}

const tile = (key, extra) => ({ key, label: key.toUpperCase(), owner: 'Ext ' + key, icon: null, mask: false, ...extra });

test('UI: arranca sin estado y sin lanzar', () => {
  const ui = mount();
  assert.strictEqual(ui.cells().length, 0);
  assert.strictEqual(ui.actions().length, 6, 'faltan los botones de abajo');
});

test('UI: un estado sin folders ni loose no rompe (el fallo del .map)', () => {
  const ui = mount();
  ui.send({ type: 'state' });
  ui.send({ type: 'state', folders: null, loose: undefined });
  ui.send({ type: 'state', folders: [{ name: 'A' }], loose: [] });   // carpeta sin tiles
  assert.strictEqual(ui.folders().length, 1);
});

test('UI: dibuja un icono por baldosa suelta', () => {
  const ui = mount({ loose: [tile('c:a'), tile('c:b'), tile('c:c')] });
  assert.strictEqual(ui.cells().length, 3);
});

test('UI: los iconos con imagen usan img y los demas la inicial', () => {
  const ui = mount({ loose: [tile('c:a', { icon: 'vsc://x.png' }), tile('c:b')] });
  assert.strictEqual(ui.doc.querySelectorAll('#items img').length, 1);
  assert.strictEqual(ui.doc.querySelectorAll('#items .glyph').length, 1);
  assert.strictEqual(ui.doc.querySelector('#items .glyph').textContent, 'C');
});

test('UI: pulsar un icono lo abre y lo marca activo', () => {
  const ui = mount({ loose: [tile('c:a')] });
  ui.cells()[0].onclick();
  assert.deepStrictEqual(ui.last(), { type: 'open', key: 'c:a' });
  assert.ok(ui.doc.querySelector('#items .cell.active'), 'no quedo marcado');
  assert.strictEqual(ui.saved.active, 'c:a', 'no se recuerda el activo');
});

test('UI: arrastrar un icono sobre otro pide agrupar', () => {
  const ui = mount({ loose: [tile('c:a'), tile('c:b')] });
  ui.dragTo(ui.cells()[0], ui.cells()[1]);
  assert.deepStrictEqual(ui.last(), { type: 'group', keys: ['c:a'], target: 'c:b' });
});

test('UI: soltar un icono sobre si mismo no manda nada', () => {
  const ui = mount({ loose: [tile('c:a')] });
  const c = ui.cells()[0];
  c.ondragstart(ui.ev());
  c.ondragover(ui.ev());
  c.ondrop(ui.ev());
  assert.strictEqual(ui.posted.length, 0);
});

test('UI: la carpeta se despliega y muestra los suyos', () => {
  const ui = mount({ folders: [{ name: 'IAs', tiles: [tile('c:a'), tile('c:b')] }], loose: [tile('c:z')] });
  assert.strictEqual(ui.doc.querySelectorAll('.kids .cell').length, 0, 'deberia empezar plegada');
  // Las carpetas ya no llevan numero: el contador es solo de las pilas.
  assert.strictEqual(ui.doc.querySelectorAll('#items .cell.folder .badge').length, 0);
  ui.folders()[0].onclick();
  assert.strictEqual(ui.doc.querySelectorAll('.kids .cell').length, 2);
  assert.deepStrictEqual(ui.saved.open, ['IAs'], 'no recuerda que quedo abierta');
  ui.folders()[0].onclick();
  assert.strictEqual(ui.doc.querySelectorAll('.kids .cell').length, 0);
});

test('UI: soltar sobre la carpeta la mete dentro', () => {
  const ui = mount({ folders: [{ name: 'IAs', tiles: [] }], loose: [tile('c:a')] });
  ui.dragTo(ui.cells()[0], ui.folders()[0]);
  assert.deepStrictEqual(ui.last(), { type: 'moveTo', keys: ['c:a'], folder: 'IAs' });
});

test('UI: arrastrar una carpeta sobre otra la reordena', () => {
  const ui = mount({ folders: [{ name: 'A', tiles: [] }, { name: 'B', tiles: [] }] });
  ui.dragTo(ui.folders()[1], ui.folders()[0]);
  assert.deepStrictEqual(ui.last(), { type: 'reorder', folder: 'B', before: 'A' });
});

test('UI: soltar en el fondo saca de la carpeta', () => {
  const ui = mount({ folders: [{ name: 'A', tiles: [tile('c:a')] }] });
  ui.folders()[0].onclick();
  const kid = ui.doc.querySelector('.kids .cell');
  kid.ondragstart(ui.ev());
  ui.doc.body.ondrop(ui.ev());
  assert.deepStrictEqual(ui.last(), { type: 'ungroup', keys: ['c:a'] });
});

test('UI: clic derecho en un agrupado ofrece sacarlo; en uno suelto no', () => {
  const ui = mount({ folders: [{ name: 'A', tiles: [tile('c:a')] }], loose: [tile('c:z')] });
  ui.folders()[0].onclick();
  ui.doc.querySelector('.kids .cell').oncontextmenu(ui.ev());
  let rows = [...ui.doc.getElementById('menu').children];
  assert.deepStrictEqual(rows.map((r) => r.textContent),
    [STR.renameTile, STR.disable, STR.uninstall, STR.hide, STR.remove]);
  rows[4].onclick();
  assert.deepStrictEqual(ui.last(), { type: 'ungroup', keys: ['c:a'] });

  // Uno suelto tiene menu, pero sin la opcion de sacarlo de ninguna carpeta.
  ui.cells().find((c) => c.dataset.key === 'c:z').oncontextmenu(ui.ev());
  rows = [...ui.doc.getElementById('menu').children];
  assert.deepStrictEqual(rows.map((r) => r.textContent),
    [STR.renameTile, STR.disable, STR.uninstall, STR.hide]);
});

test('UI: clic derecho en la carpeta ofrece ordenar, renombrar y eliminar', () => {
  const ui = mount({ folders: [{ name: 'A', tiles: [] }] });
  ui.folders()[0].oncontextmenu(ui.ev());
  const rows = [...ui.doc.getElementById('menu').children];
  assert.deepStrictEqual(rows.map((r) => r.textContent), [STR.sort, STR.rename, STR.del]);
  rows[0].onclick();
  assert.deepStrictEqual(ui.last(), { type: 'sort', folder: 'A' });
});

test('UI: los dibujos monocromos se pintan con mascara, no como imagen', () => {
  const ui = mount({ loose: [tile('c:a', { icon: 'vsc://k.svg', mask: true }), tile('c:b', { icon: 'vsc://l.png' })] });
  const masks = ui.doc.querySelectorAll('#items .mask');
  assert.strictEqual(masks.length, 1, 'no se uso la mascara');
  assert.ok(masks[0].style.maskImage.includes('k.svg') || masks[0].style.webkitMaskImage.includes('k.svg'));
  assert.strictEqual(ui.doc.querySelectorAll('#items img').length, 1);
  assert.strictEqual(ui.doc.querySelectorAll('#items .glyph').length, 0, 'no debe caer a la inicial');
});

test('UI: dentro de una carpeta soltar sobre otro icono reordena, nunca agrupa', () => {
  const ui = mount({ folders: [{ name: 'A', tiles: [tile('c:a'), tile('c:b'), tile('c:c')] }] });
  ui.folders()[0].onclick();
  const kids = [...ui.doc.querySelectorAll('.kids .cell')];
  rect(kids[1], 44, 44);
  kids[0].ondragstart(ui.ev());
  // Justo en el centro: fuera de una carpeta agruparia; aqui debe colocar.
  kids[1].ondragover(at(ui, 22, 22));
  assert.ok(!kids[1].className.includes('over'), 'sigue mostrando la marca de crear carpeta');
  assert.ok(kids[1].className.includes('ins-'), 'no marca donde va a caer');
  kids[1].ondrop(at(ui, 22, 22));
  assert.deepStrictEqual(ui.last(), { type: 'move', keys: ['c:a'], before: 'c:c' });
  kids[0].ondragstart(ui.ev());
  kids[1].ondrop(at(ui, 4, 22));
  assert.deepStrictEqual(ui.last(), { type: 'move', keys: ['c:a'], before: 'c:b' });
});

test('UI: los botones del pie mandan su mensaje', () => {
  const ui = mount({ loose: [] });
  const [nueva, ordenar, ocultos, interruptor, papelera, recargar] = ui.actions();
  for (const [boton, msg, tip] of [
    [nueva, { type: 'newFolder' }, STR.newFolder],
    [ordenar, { type: 'sort' }, STR.sortAll],
    [ocultos, { type: 'toggleHidden' }, STR.showHiddenOn],
    [recargar, { type: 'refresh' }, STR.refresh],
  ]) {
    boton.onclick();
    assert.deepStrictEqual(ui.last(), msg);
    assert.strictEqual(boton.title, tip);
  }
  // Sin nada elegido, los de grupo se ven pero no responden.
  for (const boton of [interruptor, papelera]) {
    assert.ok(boton.className.includes('disabled'));
    assert.strictEqual(boton.onclick, null, 'actuaria sobre una seleccion vacia');
    assert.strictEqual(boton.title, STR.pickFirst);
  }
});

test('UI: cada boton del pie lleva su dibujo, no una letra', () => {
  const ui = mount({ loose: [] });
  for (const boton of ui.actions()) {
    const marca = boton.querySelector('.mask');
    assert.ok(marca, 'un boton sin dibujo: ' + boton.title);
    assert.ok(/url\(/.test(marca.style.maskImage || marca.style.webkitMaskImage || ''),
      'el dibujo no se cargo: ' + boton.title);
  }
});

test('UI: el boton de ocultos cambia de titulo cuando estan a la vista', () => {
  const ui = mount({ showHidden: true, loose: [] });
  const ocultos = ui.actions()[2];
  assert.strictEqual(ocultos.title, STR.showHiddenOff);
  assert.ok(ocultos.className.includes('on'));
});

test('UI: el estado del webview sobrevive a volver a montar', () => {
  const ui = mount({ folders: [{ name: 'A', tiles: [tile('c:a')] }] });
  ui.folders()[0].onclick();
  assert.deepStrictEqual(ui.saved, { open: ['A'], active: null });
});

test('UI: 60 iconos y 5 carpetas se dibujan enteros', () => {
  const loose = Array.from({ length: 60 }, (_, i) => tile('c:' + i));
  const folders = Array.from({ length: 5 }, (_, i) => ({ name: 'F' + i, tiles: [tile('v:' + i)] }));
  const ui = mount({ loose, folders });
  assert.strictEqual(ui.cells().length, 60);
  assert.strictEqual(ui.folders().length, 5);
});

// Coloca un tamano medible en el nodo: jsdom devuelve todo a cero por defecto.
const rect = (n, w, h) => { n.getBoundingClientRect = () => ({ left: 0, top: 0, width: w, height: h }); return n; };
const at = (ui, x, y) => Object.assign(ui.ev(), { clientX: x, clientY: y });

test('UI: soltar en el borde izquierdo coloca delante, no agrupa', () => {
  const ui = mount({ loose: [tile('c:a'), tile('c:b'), tile('c:c')] });
  const [a, b] = ui.cells();
  rect(b, 48, 48);
  a.ondragstart(ui.ev());
  b.ondragover(at(ui, 4, 24));
  assert.ok(b.className.includes('ins-before'), 'no marca la linea de insercion');
  b.ondrop(at(ui, 4, 24));
  assert.deepStrictEqual(ui.last(), { type: 'move', keys: ['c:a'], before: 'c:b' });
});

test('UI: soltar en el borde derecho coloca detras', () => {
  const ui = mount({ loose: [tile('c:a'), tile('c:b'), tile('c:c')] });
  const [a, b] = ui.cells();
  rect(b, 48, 48);
  a.ondragstart(ui.ev());
  b.ondragover(at(ui, 45, 24));
  assert.ok(b.className.includes('ins-after'));
  b.ondrop(at(ui, 45, 24));
  assert.deepStrictEqual(ui.last(), { type: 'move', keys: ['c:a'], before: 'c:c' });
});

test('UI: soltar detras del ultimo icono lo manda al final', () => {
  const ui = mount({ loose: [tile('c:a'), tile('c:b')] });
  const [a, b] = ui.cells();
  rect(b, 48, 48);
  a.ondragstart(ui.ev());
  b.ondrop(at(ui, 45, 24));
  assert.deepStrictEqual(ui.last(), { type: 'move', keys: ['c:a'], before: null });
});

test('UI: soltar en el centro sigue agrupando', () => {
  const ui = mount({ loose: [tile('c:a'), tile('c:b')] });
  const [a, b] = ui.cells();
  rect(b, 48, 48);
  a.ondragstart(ui.ev());
  b.ondragover(at(ui, 24, 24));
  assert.ok(b.className.includes('over') && !b.className.includes('ins-'));
  b.ondrop(at(ui, 24, 24));
  assert.deepStrictEqual(ui.last(), { type: 'group', keys: ['c:a'], target: 'c:b' });
});

test('UI: en la cabecera de carpeta el centro mete dentro y el borde reordena', () => {
  const ui = mount({ folders: [{ name: 'A', tiles: [tile('c:x')] }], loose: [tile('c:a')] });
  const f = ui.folders()[0], a = ui.cells()[0];
  rect(f, 200, 26);
  a.ondragstart(ui.ev());
  f.ondrop(at(ui, 100, 13));
  assert.deepStrictEqual(ui.last(), { type: 'moveTo', keys: ['c:a'], folder: 'A' });
  a.ondragstart(ui.ev());
  f.ondrop(at(ui, 100, 2));
  assert.deepStrictEqual(ui.last(), { type: 'move', keys: ['c:a'], before: 'c:x' });
});

test('UI: las marcas de arrastre se limpian al terminar', () => {
  const ui = mount({ loose: [tile('c:a'), tile('c:b')] });
  const [a, b] = ui.cells();
  rect(b, 48, 48);
  a.ondragstart(ui.ev());
  b.ondragover(at(ui, 4, 24));
  a.ondragend(ui.ev());
  assert.strictEqual(ui.doc.querySelectorAll('.over, .ins-before, .ins-after').length, 0);
});

// --- apilado de iconos repetidos ---

test('UI: dos o mas con el mismo nombre se apilan en uno con su numero', () => {
  const ui = mount({ loose: [
    tile('c:a', { label: 'Claude Code' }),
    tile('c:b', { label: 'Claude Code' }),
    tile('c:c', { label: 'Claude Code' }),
    tile('c:z', { label: 'Solo' }),
  ] });
  assert.strictEqual(ui.stacks().length, 1, 'no se apilaron');
  assert.strictEqual(ui.stacks()[0].querySelector('.count').textContent, '3');
  assert.strictEqual(ui.cells().length, 1, 'el que va solo no debe apilarse');
});

test('UI: con uno solo no hay numero ni pila', () => {
  const ui = mount({ loose: [tile('c:a', { label: 'Claude Code' }), tile('c:z', { label: 'Solo' })] });
  assert.strictEqual(ui.stacks().length, 0);
  assert.strictEqual(ui.doc.querySelectorAll('#items .count').length, 0);
  assert.strictEqual(ui.cells().length, 2);
});

test('UI: la pila se abre y saca los suyos, y se cierra al volver a pulsar', () => {
  const ui = mount({ loose: [tile('c:a', { label: 'X' }), tile('c:b', { label: 'X' })] });
  assert.strictEqual(ui.doc.querySelectorAll('.pile .cell').length, 0);
  ui.stacks()[0].onclick();
  const dentro = [...ui.doc.querySelectorAll('.pile .cell')];
  assert.deepStrictEqual(dentro.map((c) => c.dataset.key), ['c:a', 'c:b']);
  assert.strictEqual(ui.posted.length, 0, 'abrir la pila no debe abrir ninguna extension');
  ui.stacks()[0].onclick();
  assert.strictEqual(ui.doc.querySelectorAll('.pile .cell').length, 0);
});

test('UI: pulsar uno de dentro de la pila si lo abre', () => {
  const ui = mount({ loose: [tile('c:a', { label: 'X' }), tile('c:b', { label: 'X' })] });
  ui.stacks()[0].onclick();
  ui.doc.querySelectorAll('.pile .cell')[1].onclick();
  assert.deepStrictEqual(ui.last(), { type: 'open', key: 'c:b' });
});

test('UI: arrastrar la pila mueve a todos sus iconos', () => {
  const ui = mount({
    folders: [{ name: 'A', tiles: [] }],
    loose: [tile('c:a', { label: 'X' }), tile('c:b', { label: 'X' })],
  });
  ui.stacks()[0].ondragstart(ui.ev());
  ui.folders()[0].ondrop(ui.ev());
  assert.deepStrictEqual(ui.last(), { type: 'moveTo', keys: ['c:a', 'c:b'], folder: 'A' });
});

test('UI: al llamarse distinto deja de apilarse con los demas', () => {
  const ui = mount({ loose: [
    tile('c:a', { label: 'X' }), tile('c:b', { label: 'X' }), tile('c:c', { label: 'Otro nombre' }),
  ] });
  assert.strictEqual(ui.stacks().length, 1);
  assert.strictEqual(ui.stacks()[0].querySelector('.count').textContent, '2');
  assert.strictEqual(ui.cells().length, 1);
});

test('UI: dentro de una carpeta tambien se apilan', () => {
  const ui = mount({ folders: [{ name: 'A', tiles: [tile('c:a', { label: 'X' }), tile('c:b', { label: 'X' })] }] });
  ui.folders()[0].onclick();
  assert.strictEqual(ui.stacks().length, 1);
});

// --- renombrar y ocultar iconos ---

test('UI: el menu de un icono ofrece renombrar, apagar, desinstalar y ocultar', () => {
  const ui = mount({ loose: [tile('c:a')] });
  ui.cells()[0].oncontextmenu(ui.ev());
  const rows = [...ui.doc.getElementById('menu').children];
  assert.deepStrictEqual(rows.map((r) => r.textContent),
    [STR.renameTile, STR.disable, STR.uninstall, STR.hide]);
  rows[0].onclick();
  assert.deepStrictEqual(ui.last(), { type: 'renameTile', key: 'c:a' });
});

test('UI: apagar una extension desde su menu', () => {
  const ui = mount({ loose: [tile('c:a')] });
  ui.cells()[0].oncontextmenu(ui.ev());
  [...ui.doc.getElementById('menu').children][1].onclick();
  assert.deepStrictEqual(ui.last(), { type: 'apply', keys: ['c:a'], action: 'disable' });
});

test('UI: una apagada se ve en gris y ofrece encenderla o quitarla', () => {
  const ui = mount({ loose: [tile('c:a', { off: true })] });
  const c = ui.cells()[0];
  assert.ok(c.className.includes('off'), 'no se distingue de una encendida');
  assert.ok(!c.title.includes(STR.disable), 'una apagada no se vuelve a apagar');
  c.onclick();
  assert.deepStrictEqual(ui.last(), { type: 'open', key: 'c:a' });
  c.oncontextmenu(ui.ev());
  const rows = [...ui.doc.getElementById('menu').children];
  assert.deepStrictEqual(rows.map((r) => r.textContent), [STR.renameTile, STR.enable, STR.forget, STR.hide]);
  rows[1].onclick();
  assert.deepStrictEqual(ui.last(), { type: 'apply', keys: ['c:a'], action: 'enable' });
  c.oncontextmenu(ui.ev());
  [...ui.doc.getElementById('menu').children][2].onclick();
  assert.deepStrictEqual(ui.last(), { type: 'forget', key: 'c:a' });
});

test('UI: los iconos de fabrica no ofrecen interruptor', () => {
  const ui = mount({ loose: [tile('n:explorer', { fixed: true })] });
  ui.cells()[0].oncontextmenu(ui.ev());
  const rows = [...ui.doc.getElementById('menu').children];
  assert.deepStrictEqual(rows.map((r) => r.textContent), [STR.renameTile, STR.hide]);
});

test('UI: un icono ya renombrado ofrece volver al nombre original', () => {
  const ui = mount({ loose: [tile('c:a', { renamed: true })] });
  ui.cells()[0].oncontextmenu(ui.ev());
  const rows = [...ui.doc.getElementById('menu').children];
  assert.deepStrictEqual(rows.map((r) => r.textContent),
    [STR.renameTile, STR.resetName, STR.disable, STR.uninstall, STR.hide]);
  rows[1].onclick();
  assert.deepStrictEqual(ui.last(), { type: 'resetName', key: 'c:a' });
});

test('UI: un icono oculto se ve atenuado y ofrece mostrarlo', () => {
  const ui = mount({ showHidden: true, loose: [tile('c:a', { hidden: true })] });
  const c = ui.cells()[0];
  assert.ok(c.className.includes('faded'), 'no se distingue de los demas');
  c.oncontextmenu(ui.ev());
  const rows = [...ui.doc.getElementById('menu').children];
  assert.deepStrictEqual(rows.map((r) => r.textContent),
    [STR.renameTile, STR.disable, STR.uninstall, STR.unhide]);
  rows[3].onclick();
  assert.deepStrictEqual(ui.last(), { type: 'unhide', keys: ['c:a'] });
});

// --- bloque nativo bloqueado ---

test('UI: los iconos del bloque nativo no se arrastran ni tienen menu', () => {
  const ui = mount({ folders: [{ name: 'Nativo', locked: true, tiles: [tile('n:explorer'), tile('n:search')] }] });
  const cabecera = ui.folders()[0];
  assert.strictEqual(cabecera.draggable, false, 'la carpeta bloqueada no debe arrastrarse');
  assert.ok(!cabecera.oncontextmenu, 'no deberia ofrecer renombrar ni borrar');

  cabecera.onclick();
  const dentro = [...ui.doc.querySelectorAll('.kids .cell')];
  assert.strictEqual(dentro.length, 2);
  for (const c of dentro) {
    assert.ok(!c.draggable, 'un nativo no debe arrastrarse');
    assert.ok(!c.oncontextmenu, 'un nativo no debe tener menu');
    assert.ok(c.className.includes('locked'));
  }
  // Pero sí se abren al pulsarlos.
  dentro[1].onclick();
  assert.deepStrictEqual(ui.last(), { type: 'open', key: 'n:search' });
});

test('UI: dentro del bloque nativo no se apila aunque coincidan nombres', () => {
  const ui = mount({ folders: [{ name: 'Nativo', locked: true,
    tiles: [tile('n:a', { label: 'X' }), tile('n:b', { label: 'X' })] }] });
  ui.folders()[0].onclick();
  assert.strictEqual(ui.stacks().length, 0, 'el bloque nativo no debe apilar');
  assert.strictEqual(ui.doc.querySelectorAll('.kids .cell').length, 2);
});

test('UI: no se puede soltar nada dentro del bloque nativo', () => {
  const ui = mount({
    folders: [{ name: 'Nativo', locked: true, tiles: [tile('n:explorer')] }],
    loose: [tile('c:a')],
  });
  ui.cells()[0].ondragstart(ui.ev());
  ui.folders()[0].ondrop(ui.ev());
  assert.strictEqual(ui.posted.length, 0, 'acepto un icono en el bloque bloqueado');
});

// --- ocultos: siempre hay vuelta atras ---

test('UI: el boton de ocultos lleva su numero y ofrece recuperarlos todos', () => {
  const ui = mount({ hiddenCount: 3, loose: [] });
  const ojo = ui.actions()[2];
  assert.strictEqual(ojo.querySelector('.count').textContent, '3', 'sin numero no se ve que hay ocultos');
  assert.ok(ojo.title.includes('3'));
  ojo.oncontextmenu(ui.ev());
  const rows = [...ui.doc.getElementById('menu').children];
  assert.deepStrictEqual(rows.map((r) => r.textContent), [STR.unhideAll]);
  rows[0].onclick();
  assert.deepStrictEqual(ui.last(), { type: 'unhideAll' });
});

test('UI: sin nada oculto el boton no lleva numero ni menu', () => {
  const ui = mount({ hiddenCount: 0, loose: [] });
  const ojo = ui.actions()[2];
  assert.strictEqual(ojo.querySelector('.count'), null);
  assert.ok(!ojo.oncontextmenu);
});

test('UI: desinstalar es una opcion aparte de apagar', () => {
  // Se separan a proposito: una es reversible al instante, la otra borra del disco.
  const ui = mount({ loose: [tile('c:a')] });
  ui.cells()[0].oncontextmenu(ui.ev());
  [...ui.doc.getElementById('menu').children][2].onclick();
  assert.deepStrictEqual(ui.last(), { type: 'uninstall', key: 'c:a' });
});

test('UI: una apagada no ofrece desinstalar, que ya no esta cargada', () => {
  const ui = mount({ loose: [tile('c:a', { off: true })] });
  ui.cells()[0].oncontextmenu(ui.ev());
  const rows = [...ui.doc.getElementById('menu').children];
  assert.ok(!rows.some((r) => r.textContent === STR.uninstall));
});

test('UI: el interruptor es uno solo, y solo marca', () => {
  const encendida = mount({ loose: [tile('c:a')] });
  encendida.cells()[0].oncontextmenu(encendida.ev());
  const rows = [...encendida.doc.getElementById('menu').children].map((r) => r.textContent);
  assert.deepStrictEqual(rows.filter((x) => /list|Desactivar|Activar/i.test(x)), [STR.disable],
    'varias formas de apagar la misma extension confunden mas de lo que ayudan');
});

// --- elegir varios con Alt ---

test('UI: Alt+clic elige, y sin Alt abre', () => {
  const ui = mount({ loose: [tile('c:a'), tile('c:b')] });
  ui.cells()[0].onclick({ altKey: true });
  assert.ok(ui.cells()[0].className.includes('sel'));
  assert.strictEqual(ui.last(), undefined, 'elegir no deberia abrir nada');

  ui.cells()[1].onclick({});
  assert.deepStrictEqual(ui.last(), { type: 'open', key: 'c:b' });
  assert.ok(!ui.cells()[0].className.includes('sel'), 'un clic normal deberia soltar lo elegido');
});

test('UI: Alt+clic otra vez lo quita de la seleccion', () => {
  const ui = mount({ loose: [tile('c:a')] });
  ui.cells()[0].onclick({ altKey: true });
  ui.cells()[0].onclick({ altKey: true });
  assert.ok(!ui.cells()[0].className.includes('sel'));
});

test('UI: ni el bloque nativo ni el propio tablero se pueden elegir', () => {
  const ui = mount({
    folders: [{ name: 'Nativo', locked: true, tiles: [tile('c:n', { fixed: true })] }],
    loose: [tile('c:yo', { fixed: true })],
  });
  ui.folders()[0].onclick();
  ui.doc.querySelector('.kids .cell').onclick({ altKey: true });
  ui.cells().find((c) => c.dataset.key === 'c:yo').onclick({ altKey: true });
  assert.strictEqual(ui.doc.querySelectorAll('.cell.sel').length, 0);
});

test('UI: arrastrar uno de los elegidos los arrastra todos', () => {
  const ui = mount({ loose: [tile('c:a'), tile('c:b'), tile('c:c')] });
  ui.cells()[0].onclick({ altKey: true });
  ui.cells()[1].onclick({ altKey: true });
  ui.cells()[0].ondragstart({ dataTransfer: null });
  assert.deepStrictEqual([...ui.board().drag.keys], ['c:a', 'c:b']);
});

test('UI: arrastrar uno de fuera de la seleccion se lleva solo a ese', () => {
  const ui = mount({ loose: [tile('c:a'), tile('c:b'), tile('c:c')] });
  ui.cells()[0].onclick({ altKey: true });
  ui.cells()[1].onclick({ altKey: true });
  ui.cells()[2].ondragstart({ dataTransfer: null });
  assert.deepStrictEqual([...ui.board().drag.keys], ['c:c']);
});

test('UI: con todo encendido el boton es pausa, y apaga el grupo', () => {
  const ui = mount({ loose: [tile('c:a'), tile('c:b')] });
  ui.cells()[0].onclick({ altKey: true });
  ui.cells()[1].onclick({ altKey: true });
  const boton = ui.actions()[3];
  assert.ok(/debug-pause/.test(boton.querySelector('.mask').style.maskImage));
  assert.ok(boton.title.includes('2'));
  boton.onclick();
  assert.deepStrictEqual(ui.last(), { type: 'apply', keys: ['c:a', 'c:b'], action: 'disable' });
});

test('UI: con todo apagado el boton es play, y enciende el grupo', () => {
  const ui = mount({ loose: [tile('c:a', { off: true }), tile('c:b', { off: true })] });
  ui.cells()[0].onclick({ altKey: true });
  ui.cells()[1].onclick({ altKey: true });
  const boton = ui.actions()[3];
  assert.ok(/play/.test(boton.querySelector('.mask').style.maskImage));
  boton.onclick();
  assert.deepStrictEqual(ui.last(), { type: 'apply', keys: ['c:a', 'c:b'], action: 'enable' });
});

test('UI: mezclando encendidas y apagadas el boton se apaga y explica por que', () => {
  const ui = mount({ loose: [tile('c:a'), tile('c:b', { off: true })] });
  ui.cells()[0].onclick({ altKey: true });
  ui.cells()[1].onclick({ altKey: true });
  const boton = ui.actions()[3];
  assert.ok(boton.className.includes('disabled'));
  assert.strictEqual(boton.onclick, null, 'apagaria o encenderia eligiendo por su cuenta');
  assert.strictEqual(boton.title, STR.mixedPick);
});

test('UI: la papelera desinstala lo elegido', () => {
  const ui = mount({ loose: [tile('c:a'), tile('c:b')] });
  ui.cells()[0].onclick({ altKey: true });
  const papelera = ui.actions()[4];
  assert.ok(!papelera.className.includes('disabled'));
  papelera.onclick();
  assert.deepStrictEqual(ui.last(), { type: 'uninstallMany', keys: ['c:a'] });
});

test('UI: el ojo se abre y se cierra segun lo que hace', () => {
  const oculto = mount({ loose: [], showHidden: false });
  assert.ok(/eye-closed/.test(oculto.actions()[2].querySelector('.mask').style.maskImage));
  const visto = mount({ loose: [], showHidden: true });
  assert.ok(/eye\.svg/.test(visto.actions()[2].querySelector('.mask').style.maskImage));
});

test('UI: lo elegido que desaparece deja de contar', () => {
  const ui = mount({ loose: [tile('c:a'), tile('c:b')] });
  ui.cells()[0].onclick({ altKey: true });
  ui.cells()[1].onclick({ altKey: true });
  ui.send({ type: 'state', folders: [], loose: [tile('c:a')] });      // c:b ya no esta
  assert.strictEqual(ui.board().selState().count, 1, 'contaria iconos que ya no existen');
});

test('UI: al cargar pide el estado en vez de esperarlo', () => {
  // Lo que la extension manda justo despues de fijar el HTML llega antes de que exista
  // este guion y se pierde: el tablero se quedaba en negro sin decir nada.
  const ui = mount();
  assert.deepStrictEqual(ui.saludo.map((m) => m.type), ['ready']);
});

test('UI: el pie no ofrece aplicar aparte: eso lo hace pausa o play', () => {
  const ui = mount({ loose: [tile('c:a')] });
  assert.strictEqual(ui.actions().length, 6, 'sobra o falta un boton abajo');
  ui.cells()[0].onclick({ altKey: true });
  assert.strictEqual(ui.actions().length, 6, 'elegir no deberia sacar botones nuevos');
});

test('UI: elegir no pone numeritos encima del icono', () => {
  const ui = mount({ loose: [tile('c:a'), tile('c:b')] });
  ui.cells()[0].onclick({ altKey: true });
  ui.cells()[1].onclick({ altKey: true });
  // Lo unico que distingue a una elegida es el recuadro.
  assert.strictEqual(ui.doc.querySelectorAll('#items .cell .count').length, 0);
  assert.strictEqual(ui.doc.querySelectorAll('#actions .cell .count').length, 0);
  assert.strictEqual(ui.doc.querySelectorAll('.cell.sel').length, 2);
});

test('UI: solo una regla dibuja sobre el icono, para que no se pisen', () => {
  // Un elemento tiene un unico ::after. Habia dos reglas peleandoselo —el recuadro de
  // elegida y una bolita de apagada— y al elegir una apagada se mezclaban: el ancho de
  // la bolita colapsaba el recuadro en un punto arriba a la izquierda.
  const css = fs.readFileSync(path.join(__dirname, '..', 'media', 'board.css'), 'utf8');
  const dibujan = css.match(/\.cell[^{,]*::after/g) || [];
  assert.deepStrictEqual(dibujan, ['.cell.sel::after'],
    'dos reglas sobre el mismo ::after se mezclan sin avisar: ' + dibujan.join(', '));
});
