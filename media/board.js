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
   * Varias extensiones con el mismo nombre (tres "Claude Code", por ejemplo) se muestran
   * como un solo icono con el numero en la esquina. Con uno solo no se apila nada.
   */
  function stacked(list) {
    const groups = new Map();
    for (const x of list) {
      const k = (x.label || '').trim().toLowerCase();
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(x);
    }
    const out = [], done = new Set();
    for (const x of list) {
      const k = (x.label || '').trim().toLowerCase();
      if (done.has(k)) continue;
      done.add(k);
      const g = groups.get(k);
      out.push(g.length > 1 ? { stack: 'stack:' + k, label: x.label, icon: x.icon, mask: x.mask, tiles: g } : x);
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
      drag = { keys };
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
      if (z === 'center') post({ type: 'group', keys: drag.keys, target: keys[0] });
      else post({ type: 'move', keys: drag.keys, before: z === 'before' ? keys[0] : nextKey });
    };
  }

  function menuFor(t) {
    const rows = [[S.renameTile, () => post({ type: 'renameTile', key: t.key })]];
    if (t.renamed) rows.push([S.resetName, () => post({ type: 'resetName', key: t.key })]);
    // El interruptor: los iconos de fabrica y el propio tablero no se apagan.
    if (!t.fixed) {
      rows.push(t.off
        ? [S.enable, () => post({ type: 'enable', key: t.key })]
        : [S.disable, () => post({ type: 'disable', key: t.key })]);
    }
    rows.push(t.hidden
      ? [S.unhide, () => post({ type: 'unhide', keys: [t.key] })]
      : [S.hide, () => post({ type: 'hide', keys: [t.key] })]);
    if (folderOf(t.key)) rows.push([S.remove, () => post({ type: 'ungroup', keys: [t.key] })]);
    return rows;
  }

  /** Un icono de extension, con el mismo tamano y foco que los de la barra real. */
  function cell(t, inside, list, i, locked) {
    const nextKey = list && list[i + 1] ? (list[i + 1].key || (list[i + 1].tiles || [])[0].key) : null;
    const n = el('div', 'cell' + (active === t.key ? ' active' : '') +
      (inside ? ' inside' : '') + (t.hidden ? ' faded' : '') + (t.off ? ' off' : ''));
    n.title = t.label + (t.owner && t.owner !== t.label ? ' — ' + t.owner : '') +
      (t.off ? ' · ' + S.enable : '');
    n.dataset.key = t.key;
    n.appendChild(art(t));

    n.onclick = () => {
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
    draggable(n, [t.key]);
    dropTarget(n, [t.key], nextKey, inside);
    n.oncontextmenu = (e) => menu(e, menuFor(t));
    return n;
  }

  /** Varios iconos del mismo nombre: uno solo con el numero, que se abre al pulsarlo. */
  function stackCell(s, list, i) {
    const nextKey = list && list[i + 1] ? (list[i + 1].key || (list[i + 1].tiles || [])[0].key) : null;
    const keys = s.tiles.map((x) => x.key);
    const n = el('div', 'cell stack' + (open.has(s.stack) ? ' open' : ''));
    n.title = s.label + ' (' + s.tiles.length + ')';
    n.dataset.stack = s.stack;
    n.appendChild(art(s));
    el('span', 'count', n).textContent = s.tiles.length;

    n.onclick = () => {
      open.has(s.stack) ? open.delete(s.stack) : open.add(s.stack);
      persist();
      render();
    };
    draggable(n, keys);
    dropTarget(n, keys, nextKey, false);
    n.oncontextmenu = (e) => menu(e, [
      [S.hide, () => post({ type: 'hide', keys })],
      [S.sort, () => post({ type: 'sort', folder: null })],
    ]);
    return n;
  }

  /** Una carpeta: cabecera de fila entera que despliega sus iconos debajo. */
  function folderCell(f) {
    const n = el('div', 'cell folder' + (open.has(f.name) ? ' open' : '') + (f.locked ? ' locked' : ''));
    n.draggable = !f.locked;
    n.title = f.name;
    n.dataset.folder = f.name;
    el('span', 'folder-icon', n).textContent = open.has(f.name) ? '▾' : '▸';
    el('span', 'folder-name', n).textContent = f.name;

    n.onclick = () => {
      open.has(f.name) ? open.delete(f.name) : open.add(f.name);
      persist();
      render();
    };
    if (!f.locked) {
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
      if (!drag || f.locked) return;
      e.preventDefault();
      e.stopPropagation();
      clearOver();
      mark(n, drag.folder ? 'center' : zone(e, n, true));
    };
    n.ondrop = (e) => {
      if (!drag || f.locked) return;
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
    const btn = (text, tip, fn, on) => {
      const b = el('div', 'cell action' + (on ? ' on' : ''), actions);
      b.textContent = text;
      b.title = tip;
      b.onclick = fn;
      return b;
    };
    btn('＋', S.newFolder, () => post({ type: 'newFolder' }));
    btn('A↓', S.sortAll, () => post({ type: 'sort' }));
    const ocultos = state.hiddenCount || 0;
    const ojo = btn('◉', (state.showHidden ? S.showHiddenOff : S.showHiddenOn) +
      (ocultos ? ' (' + ocultos + ')' : ''), () => post({ type: 'toggleHidden' }), state.showHidden);
    // Con iconos escondidos, el boton lleva su numero y ofrece recuperarlos todos de golpe.
    if (ocultos) {
      el('span', 'count', ojo).textContent = ocultos;
      ojo.oncontextmenu = (e) => menu(e, [[S.unhideAll, () => post({ type: 'unhideAll' })]]);
    }
    btn('⇥', S.dock, () => post({ type: 'dock' }));
    btn('↻', S.refresh, () => post({ type: 'refresh' }));
  }

  /** Pinta una lista de baldosas aplicando el apilado por nombre. */
  function paint(list, parent, inside, locked) {
    // En un bloque bloqueado no se apila nada: los iconos van uno a uno, en su orden.
    const rows = locked ? list : stacked(list);
    rows.forEach((x, i) => {
      if (!x.stack) return parent.appendChild(cell(x, inside, rows, i, locked));
      parent.appendChild(stackCell(x, rows, i));
      if (!open.has(x.stack)) return;
      const box = el('div', 'kids pile', parent);
      x.tiles.forEach((sub, j) => box.appendChild(cell(sub, inside, x.tiles, j)));
    });
  }

  function render() {
    closeMenu();
    items.textContent = '';
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
    renderActions();
  }

  // Soltar en el fondo saca de la carpeta.
  document.body.ondragover = (e) => { if (drag && drag.keys) e.preventDefault(); };
  document.body.ondrop = (e) => {
    if (!drag || !drag.keys) return;
    e.preventDefault();
    post({ type: 'ungroup', keys: drag.keys });
  };

  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'state') { state = e.data; render(); }
  });
  render();

  // Solo para las pruebas: expone el estado interno del webview.
  window.__board = { render, stacked, get state() { return state; }, get drag() { return drag; }, open };
})();
