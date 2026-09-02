// GG Groups — copia de la barra de actividad de VS Code, con carpetas: se agrupan arrastrando un icono sobre otro.
(function () {
  const vscode = acquireVsCodeApi();
  const items = document.getElementById('items');
  const actions = document.getElementById('actions');
  const S = window.STR || {};
  let state = { folders: [], loose: [] };
  let drag = null;                 // { keys: [...] } o { folder: nombre }
  const saved = vscode.getState() || {};
  const open = new Set(saved.open || []);   // carpetas y pilas desplegadas
  let active = saved.active || null;        // ultimo icono pulsado
  // Seleccion con Alt. No se guarda entre sesiones a proposito: es de usar y tirar, y
  // encontrarse iconos seleccionados al volver seria una sorpresa desagradable.
  const sel = new Set();
  const ICONS = window.ICONS || {};
  const DOBLE_TOQUE = 450;                  // ms entre los dos toques de Ctrl
  // Ctrl en Windows y Linux, Cmd en Mac: la misma tecla de "y ademas este" de siempre.
  const eligiendo = (e) => !!e && (e.ctrlKey || e.metaKey);

  const el = (tag, cls, parent) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  };
  const post = (msg) => vscode.postMessage(msg);
  const persist = () => vscode.setState({ open: [...open], active });
  const clearOver = () => [...document.querySelectorAll('.over, .ins-before, .ins-after')]
    .forEach((n) => n.classList.remove('over', 'ins-before', 'ins-after'));
  const folderOf = (key) => state.folders.find((f) => (f.tiles || []).some((x) => x.key === key));

  /**
   * Todas las baldosas pintadas, vengan de donde vengan. Dejarse las secciones fuera hacia
   * que al repintar se descartara como 'ya no existe' todo lo elegido ahi dentro: con el
   * ojo abierto, donde vive casi todo, elegir con Ctrl no duraba ni un repintado.
   */
  const allTiles = () => []
    .concat(...(state.folders || []).map((f) => f.tiles || []))
    .concat(...(state.sections || []).map((f) => f.tiles || []))
    .concat(state.loose || []);
  const selectedTiles = () => allTiles().filter((x) => sel.has(x.key));

  function toggleSel(keys) {
    for (const k of keys) sel.has(k) ? sel.delete(k) : sel.add(k);
    render();
  }

  /**
   * Que puede hacerse con lo seleccionado. Apagar y encender no se mezclan: con unas
   * encendidas y otras apagadas no hay una accion sensata que aplicar a todas, asi que
   * el boton se apaga en vez de elegir por su cuenta.
   */
  function selState() {
    const tiles = selectedTiles();
    if (!tiles.length) return { count: 0, action: 'disable', ready: false, mixed: false };
    const off = tiles.filter((x) => x.off).length;
    const mixed = off > 0 && off < tiles.length;
    return { count: tiles.length, action: off ? 'enable' : 'disable', ready: !mixed, mixed };
  }

  /**
   * Varias extensiones con el mismo nombre (tres "Claude Code", por ejemplo) se muestran
   * como un solo icono con el numero en la esquina. Con uno solo no se apila nada.
   */
  function stacked(list) {
    const clave = (x) => x.group || (x.label || '').trim().toLowerCase();
    const groups = new Map();
    for (const x of list) {
      const k = clave(x);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(x);
    }
    const out = [], done = new Set();
    for (const x of list) {
      const k = clave(x);
      if (done.has(k)) continue;
      done.add(k);
      const g = groups.get(k);
      // El primero manda: la extension viene ordenada con la que da la cara delante, asi
      // que la pila toma su nombre y su dibujo. Si esa no trae dibujo se coge el del
      // primero que tenga: una letra representando a un grupo con logos seria una pena.
      const conDibujo = x.icon ? x : (g.find((y) => y.icon) || x);
      out.push(g.length > 1
        ? { stack: 'stack:' + k, label: x.label, icon: conDibujo.icon, mask: conDibujo.mask, tiles: g }
        : x);
    }
    return out;
  }

  /**
   * Igual que la barra lateral de VS Code: por los bordes se coloca entre iconos,
   * por el centro se suelta encima. Dentro de una carpeta no hay centro — ahi solo
   * se reordena. Si el nodo no tiene tamano medible, centro.
   */
  function zone(e, n, vertical, noCenter) {
    const r = n.getBoundingClientRect ? n.getBoundingClientRect() : null;
    const size = r && (vertical ? r.height : r.width);
    if (!size) return noCenter ? 'before' : 'center';
    const pos = (vertical ? (e.clientY || 0) - r.top : (e.clientX || 0) - r.left) / size;
    if (noCenter) return pos < 0.5 ? 'before' : 'after';
    if (pos < 0.3) return 'before';
    if (pos > 0.7) return 'after';
    return 'center';
  }
  const mark = (n, z) => n.classList.add(z === 'center' ? 'over' : 'ins-' + z);

  function glyph(t) {
    const n = el('span', 'glyph');
    n.textContent = (t.label || '?').trim().charAt(0).toUpperCase() || '?';
    return n;
  }

  /** Los dibujos de un solo color se pintan con el color del tema, como hace VS Code. */
  function art(t) {
    if (!t.icon) return glyph(t);
    if (t.mask) {
      const n = document.createElement('span');
      n.className = 'mask';
      n.style.webkitMaskImage = 'url("' + t.icon + '")';
      n.style.maskImage = 'url("' + t.icon + '")';
      return n;
    }
    const img = document.createElement('img');
    img.src = t.icon;
    img.alt = '';
    img.onerror = () => img.replaceWith(glyph(t));   // icono roto: cae a la inicial
    return img;
  }

  /** Arrastre comun a iconos y pilas. */
  function draggable(n, keys) {
    n.draggable = true;
    n.ondragstart = (e) => {
      // Si lo que se arrastra es parte de la seleccion, van todos: es justo para lo que
      // sirve seleccionar varios.
      const ks = sel.size > 1 && keys.some((k) => sel.has(k)) ? allTiles().map((x) => x.key).filter((k) => sel.has(k)) : keys;
      drag = { keys: ks };
      n.classList.add('dragging');
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', keys[0]); }
    };
    n.ondragend = () => { drag = null; n.classList.remove('dragging'); clearOver(); };
  }

  /** Zona de soltado comun: bordes recolocan, centro agrupa (salvo dentro de carpeta). */
  function dropTarget(n, keys, nextKey, inside) {
    const mine = (k) => keys.indexOf(k) >= 0;
    n.ondragover = (e) => {
      if (!drag || !drag.keys || drag.keys.some(mine)) return;
      e.preventDefault();
      e.stopPropagation();
      clearOver();
      mark(n, zone(e, n, false, inside));
    };
    n.ondrop = (e) => {
      if (!drag || !drag.keys || drag.keys.some(mine)) return;
      e.preventDefault();
      e.stopPropagation();
      const z = zone(e, n, false, inside);
      if (z === 'center') post({ type: 'merge', keys: drag.keys, target: keys[0] });
      else post({ type: 'move', keys: drag.keys, before: z === 'before' ? keys[0] : nextKey });
    };
  }

  function menuFor(t) {
    const rows = [];
    // Lo primero, si lo hay: actualizar es lo que se viene a hacer cuando se ve el aviso.
    if (t.update) {
      rows.push([S.update.replace('{0}', t.update), () => post({ type: 'update', key: t.key })]);
    }
    rows.push([S.renameTile, () => post({ type: 'renameTile', key: t.key })]);
    if (t.renamed) rows.push([S.resetName, () => post({ type: 'resetName', key: t.key })]);
    // El interruptor: los iconos de fabrica y el propio tablero no se apagan.
    if (!t.fixed) {
      // Un solo interruptor, y aplica en el acto: pregunta y cierra VS Code para hacerlo.
      rows.push([t.off ? S.enable : S.disable,
                 () => post({ type: 'apply', keys: [t.key], action: t.off ? 'enable' : 'disable' })]);
      // Desactivar es reversible; desinstalar borra del disco. Van por separado.
      if (t.off) rows.push([S.forget, () => post({ type: 'forget', key: t.key })]);
      else rows.push([S.uninstall, () => post({ type: 'uninstall', key: t.key })]);
    }
    rows.push(t.hidden
      ? [S.unhide, () => post({ type: 'unhide', keys: [t.key] })]
      : [S.hide, () => post({ type: 'hide', keys: [t.key] })]);
    if (folderOf(t.key)) rows.push([S.remove, () => post({ type: 'ungroup', keys: [t.key] })]);
    return rows;
  }

  /** Un icono de extension, con el mismo tamano y foco que los de la barra real. */
  function cell(t, inside, list, i, locked, seccion) {
    const nextKey = list && list[i + 1] ? (list[i + 1].key || (list[i + 1].tiles || [])[0].key) : null;
    const n = el('div', 'cell' + (active === t.key ? ' active' : '') +
      (inside ? ' inside' : '') + (t.hidden ? ' faded' : '') + (t.off ? ' off' : '') +
      (sel.has(t.key) ? ' sel' : '') + (t.update ? ' updatable' : ''));
    // Ni el bloque nativo ni el propio tablero: ninguna accion de grupo les aplica.
    const elegible = !locked && !t.fixed;
    n.title = t.label + (t.owner && t.owner !== t.label ? ' — ' + t.owner : '') +
      (t.update ? ' · ' + S.update.replace('{0}', t.update) : '');
    n.dataset.key = t.key;
    n.appendChild(art(t));

    n.onclick = (e) => {
      if (elegible && eligiendo(e)) return toggleSel([t.key]);
      sel.clear();
      active = t.key;
      persist();
      render();
      post({ type: 'open', key: t.key });
    };
    // Los nativos van fijos: ni se arrastran, ni se renombran, ni se ocultan.
    if (locked) {
      n.classList.add('locked');
      return n;
    }
    // En una seccion no se reordena: lo que hay ahi lo decide su estado, no el usuario.
    if (!seccion) {
      draggable(n, [t.key]);
      dropTarget(n, [t.key], nextKey, inside);
    }
    n.oncontextmenu = (e) => menu(e, menuFor(t));
    return n;
  }

  /** Varios iconos del mismo nombre: uno solo con el numero, que se abre al pulsarlo. */
  function stackCell(s, list, i, seccion) {
    const nextKey = list && list[i + 1] ? (list[i + 1].key || (list[i + 1].tiles || [])[0].key) : null;
    const keys = s.tiles.map((x) => x.key);
    // Elegida cuando lo estan todas las suyas: es lo que deja un Ctrl+clic encima. Y en
    // gris cuando lo estan todas: una pila a todo color sobre un grupo entero apagado dice
    // lo contrario de lo que pasa.
    const todas = (f) => s.tiles.length && s.tiles.every(f);
    const elegida = keys.length && keys.every((k) => sel.has(k));
    const n = el('div', 'cell stack' + (open.has(s.stack) ? ' open' : '') + (elegida ? ' sel' : '') +
      (todas((x) => x.off) ? ' off' : '') + (todas((x) => x.hidden) ? ' faded' : ''));
    n.title = s.label + ' (' + s.tiles.length + ')';
    n.dataset.stack = s.stack;
    n.appendChild(art(s));
    el('span', 'count', n).textContent = s.tiles.length;

    n.onclick = (e) => {
      // Con Ctrl entran todas las de la pila: es lo que se ve, y es lo que se espera.
      if (eligiendo(e)) return toggleSel(keys.filter((k) => !sel.has(k)).length ? keys.filter((k) => !sel.has(k)) : keys);
      open.has(s.stack) ? open.delete(s.stack) : open.add(s.stack);
      persist();
      render();
    };
    if (!seccion) {
      draggable(n, keys);
      dropTarget(n, keys, nextKey, false);
    }
    n.oncontextmenu = (e) => menu(e, [
      [S.face, () => post({ type: 'face', keys })],
      [S.split, () => post({ type: 'split', keys })],
      [S.hide, () => post({ type: 'hide', keys })],
      [S.sort, () => post({ type: 'sort', folder: null })],
    ]);
    return n;
  }

  /** Una carpeta: cabecera de fila entera que despliega sus iconos debajo. */
  function folderCell(f) {
    const fijo = f.locked || f.section;
    const n = el('div', 'cell folder' + (open.has(f.name) ? ' open' : '') +
      (f.locked ? ' locked' : '') + (f.section ? ' section' : ''));
    n.draggable = !fijo;
    n.title = f.name;
    n.dataset.folder = f.name;
    el('span', 'folder-icon', n).textContent = open.has(f.name) ? '▾' : '▸';
    el('span', 'folder-name', n).textContent = f.name;

    n.onclick = () => {
      open.has(f.name) ? open.delete(f.name) : open.add(f.name);
      persist();
      render();
    };
    if (!fijo) {
      n.oncontextmenu = (e) => menu(e, [
        [S.sort, () => post({ type: 'sort', folder: f.name })],
        [S.rename, () => post({ type: 'rename', folder: f.name })],
        [S.del, () => post({ type: 'delete', folder: f.name })],
      ]);
    }
    n.ondragstart = (e) => {
      drag = { folder: f.name };
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', f.name); }
    };
    n.ondragend = () => { drag = null; clearOver(); };
    n.ondragover = (e) => {
      if (!drag || fijo) return;
      e.preventDefault();
      e.stopPropagation();
      clearOver();
      mark(n, drag.folder ? 'center' : zone(e, n, true));
    };
    n.ondrop = (e) => {
      if (!drag || fijo) return;
      e.preventDefault();
      e.stopPropagation();
      if (!drag.keys) {
        if (drag.folder !== f.name) post({ type: 'reorder', folder: drag.folder, before: f.name });
        return;
      }
      const z = zone(e, n, true);
      if (z === 'center') post({ type: 'moveTo', keys: drag.keys, folder: f.name });
      else post({ type: 'move', keys: drag.keys, before: z === 'before' ? firstKey(f) : null });
    };
    return n;
  }

  // Primera baldosa que sigue a la carpeta: sirve de referencia al colocar antes de ella.
  const firstKey = (f) => {
    const i = state.folders.indexOf(f);
    for (let j = i; j < state.folders.length; j++) {
      const list = state.folders[j].tiles || [];
      if (list.length) return list[0].key;
    }
    return (state.loose || [])[0] ? state.loose[0].key : null;
  };

  function menu(e, entries) {
    e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    closeMenu();
    const m = el('div', null, document.body);
    m.id = 'menu';
    entries.forEach(([text, fn]) => {
      const row = el('div', null, m);
      row.textContent = text;
      row.onclick = () => { closeMenu(); fn(); };
    });
    m.style.left = Math.max(0, Math.min(e.clientX || 0, window.innerWidth - 170)) + 'px';
    m.style.top = Math.max(0, Math.min(e.clientY || 0, window.innerHeight - 20 * entries.length - 12)) + 'px';
    return m;
  }
  const closeMenu = () => { const m = document.getElementById('menu'); if (m) m.remove(); };
  document.addEventListener('click', closeMenu);
  document.addEventListener('contextmenu', closeMenu, true);

  /** Los botones del pie, como el engranaje de la barra real. */
  function renderActions() {
    actions.textContent = '';
    const btn = (icono, tip, fn, extra) => {
      const b = el('div', 'cell action' + (extra || ''), actions);
      const marca = el('span', 'mask', b);
      marca.style.webkitMaskImage = 'url("' + (ICONS[icono] || '') + '")';
      marca.style.maskImage = 'url("' + (ICONS[icono] || '') + '")';
      b.title = tip;
      if (fn) b.onclick = fn;
      return b;
    };
    btn('new-folder', S.newFolder, () => post({ type: 'newFolder' }));
    btn('list-ordered', S.sortAll, () => post({ type: 'sort' }));

    const ocultos = state.hiddenCount || 0;
    // El ojo dice en que estado esta: abierto se ven, cerrado no.
    const ojo = btn(state.showHidden ? 'eye' : 'eye-closed',
      (state.showHidden ? S.showHiddenOff : S.showHiddenOn) + (ocultos ? ' (' + ocultos + ')' : ''),
      () => post({ type: 'toggleHidden' }), state.showHidden ? ' on' : '');
    if (ocultos) {
      el('span', 'count', ojo).textContent = ocultos;
      ojo.oncontextmenu = (e) => menu(e, [[S.unhideAll, () => post({ type: 'unhideAll' })]]);
    }

    // Pausa o play segun lo seleccionado; gris cuando no hay nada que hacer con ello.
    const s2 = selState();
    const puede = s2.count > 0 && s2.ready;
    btn(s2.action === 'enable' ? 'play' : 'debug-pause',
      !s2.count ? S.pickFirst : (s2.mixed ? S.mixedPick
        : (s2.action === 'enable' ? S.enableSel : S.disableSel) + ' (' + s2.count + ')'),
      puede ? () => post({ type: 'apply', keys: [...sel], action: s2.action }) : null,
      puede ? '' : ' disabled');

    btn('trash', s2.count ? S.uninstallSel + ' (' + s2.count + ')' : S.pickFirst,
      s2.count ? () => post({ type: 'uninstallMany', keys: [...sel] }) : null,
      s2.count ? '' : ' disabled');

    const recargar = btn('refresh', S.refresh, () => post({ type: 'refresh' }));
    // Preguntar al mercado sale de aqui y no de un boton propio: es algo que se hace de
    // vez en cuando, y es la unica accion que habla con fuera.
    recargar.oncontextmenu = (e) => menu(e, [[S.checkUpdates, () => post({ type: 'checkUpdates' })]]);
  }

  /** Pinta una lista de baldosas aplicando el apilado por nombre. */
  function paint(list, parent, inside, locked, seccion) {
    // En un bloque bloqueado no se apila nada: los iconos van uno a uno, en su orden.
    const rows = locked ? list : stacked(list);
    rows.forEach((x, i) => {
      if (!x.stack) return parent.appendChild(cell(x, inside, rows, i, locked, seccion));
      parent.appendChild(stackCell(x, rows, i, seccion));
      if (!open.has(x.stack)) return;
      const box = el('div', 'kids pile', parent);
      x.tiles.forEach((sub, j) => box.appendChild(cell(sub, inside, x.tiles, j, false, seccion)));
    });
  }

  function render() {
    closeMenu();
    items.textContent = '';
    // Una baldosa puede desaparecer entre dos repintados; dejarla seleccionada haria que
    // los botones contaran cosas que ya no estan.
    const vivas = new Set(allTiles().map((x) => x.key));
    for (const k of [...sel]) if (!vivas.has(k)) sel.delete(k);
    const folders = Array.isArray(state.folders) ? state.folders : [];
    const loose = Array.isArray(state.loose) ? state.loose : [];

    for (const f of folders) {
      items.appendChild(folderCell(f));
      if (!open.has(f.name)) continue;
      const kids = el('div', 'kids', items);
      const tiles = f.tiles || [];
      if (!tiles.length) el('div', 'empty', kids).textContent = '·';
      paint(tiles, kids, true, f.locked);
      if (f.locked) continue;
      // Soltar en el hueco de la carpeta tambien mete dentro.
      kids.ondragover = (e) => { if (drag && drag.keys) { e.preventDefault(); clearOver(); kids.classList.add('over'); } };
      kids.ondrop = (e) => {
        if (!drag || !drag.keys) return;
        e.preventDefault();
        e.stopPropagation();
        post({ type: 'moveTo', keys: drag.keys, folder: f.name });
      };
    }

    if (folders.length && loose.length) el('div', 'sep', items);
    paint(loose, items, false);

    // Las secciones cierran el tablero: lo que no esta en la barra, y lo apagado.
    for (const f of (Array.isArray(state.sections) ? state.sections : [])) {
      items.appendChild(folderCell(f));
      if (!open.has(f.name)) continue;
      const kids = el('div', 'kids', items);
      paint(f.tiles || [], kids, true, false, true);
    }
    renderActions();
  }

  // Soltar en el fondo saca de la carpeta.
  document.body.ondragover = (e) => { if (drag && drag.keys) e.preventDefault(); };
  document.body.ondrop = (e) => {
    if (!drag || !drag.keys) return;
    e.preventDefault();
    post({ type: 'ungroup', keys: drag.keys });
  };

  // Dos toques rapidos de Ctrl sueltan la eleccion. Deshacerla con solo soltar la tecla
  // obligaria a tenerla apretada para pulsar los botones del pie, que es justo lo que se
  // hace despues de elegir. Escape hace lo mismo, que es lo que se espera de Escape.
  let ultimoCtrl = 0;
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Escape') return soltar();
    if (e.key !== 'Control' && e.key !== 'Meta') return;
    const ahora = Date.now();
    if (ahora - ultimoCtrl < DOBLE_TOQUE) soltar();
    ultimoCtrl = ahora;
  });
  function soltar() {
    if (!sel.size) return;
    sel.clear();
    render();
  }

  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'state') { state = e.data; render(); }
  });
  render();
  // Se pide el estado en vez de esperarlo: lo que la extension mande justo despues de
  // fijar el HTML llega antes de que este guion exista y se pierde sin dejar rastro.
  post({ type: 'ready' });

  // Solo para las pruebas: expone el estado interno del webview.
  window.__board = { render, stacked, get state() { return state; }, get drag() { return drag; }, open, sel, selState };
})();
