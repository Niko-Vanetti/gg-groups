/**
 * Extensiones de mentira que cubren todos los casos que el tablero tiene que distinguir.
 *
 * Antes las pruebas leian las extensiones instaladas en la maquina: eso ataba la suite a
 * un equipo concreto y hacia que el resultado dependiera de lo que cada uno tuviera puesto.
 * Con estas piezas fijas, cualquiera puede clonar el repositorio y obtener el mismo resultado.
 */
const path = require('path');

const ASSETS = path.join(__dirname, 'assets');
const uri = { fsPath: ASSETS };

/** Atajo para describir una extension sin repetir la estructura entera. */
const ext = (id, contributes, extra = {}) => ({
  id,
  extensionUri: uri,
  packageJSON: { name: id.split('.')[1], publisher: id.split('.')[0], contributes, ...extra },
});

module.exports = [
  // Caso normal: un contenedor en la barra, una vista sin condiciones y logo propio.
  ext('acme.notes', {
    viewsContainers: { activitybar: [{ id: 'notesView', title: 'Notes', icon: 'mono.svg' }] },
    views: { notesView: [{ id: 'notesTree', name: 'Notes' }] },
  }, { displayName: 'Notes', icon: 'notes.png' }),

  // Una extension con dos iconos: apagarla debe apagar los dos.
  ext('acme.tasks', {
    viewsContainers: {
      activitybar: [{ id: 'tasksView', title: 'Tasks', icon: 'mono.svg' }],
      secondarySidebar: [{ id: 'tasksSecondary', title: 'Tasks', icon: 'mono.svg' }],
    },
    views: {
      tasksView: [{ id: 'tasksMain', name: 'Tasks' }, { id: 'tasksExtra', name: 'More' }],
      tasksSecondary: [{ id: 'tasksAside', name: 'Aside' }],
    },
  }, { displayName: 'Tasks', icon: 'tasks.png' }),

  // Sus vistas dependen de una context key ajena: no se puede saber, asi que se muestra.
  ext('acme.build', {
    viewsContainers: { activitybar: [{ id: 'buildView', title: 'Build', icon: 'mono.svg' }] },
    views: { buildView: [{ id: 'buildTree', name: 'Build', when: 'build:ready' }] },
  }, { displayName: 'Build', icon: 'build.png' }),

  // Otra extension distinta con el MISMO dibujo que Build. En la barra parecen la misma
  // cosa, asi que el tablero las junta en un icono con su numero: es el caso real de
  // C/C++, sus temas y su paquete, que comparten logo.
  ext('acme.buildtwin', {
    viewsContainers: { activitybar: [{ id: 'twinView', title: 'Build Themes', icon: 'mono.svg' }] },
    views: { twinView: [{ id: 'twinTree', name: 'Twin' }] },
  }, { displayName: 'Build Themes', icon: 'build.png' }),

  // No declara ninguna vista: VS Code no lo pinta en la barra y aqui tampoco.
  ext('acme.empty', {
    viewsContainers: { activitybar: [{ id: 'emptyView', title: 'Empty', icon: 'mono.svg' }] },
  }, { displayName: 'Empty', icon: 'empty.png' }),

  // Su unica vista depende de un ajuste apagado: se descarta con certeza.
  ext('acme.settingsy', {
    viewsContainers: { activitybar: [{ id: 'settingsyView', title: 'Settingsy', icon: 'mono.svg' }] },
    views: { settingsyView: [{ id: 'settingsyTree', name: 'S', when: 'config.acme.showPanel' }] },
  }, { displayName: 'Settingsy', icon: 'settingsy.png' }),

  // Vive en el panel de abajo, que no es una barra lateral.
  ext('acme.bottom', {
    viewsContainers: { panel: [{ id: 'bottomView', title: 'Bottom', icon: 'mono.svg' }] },
    views: { bottomView: [{ id: 'bottomTree', name: 'Bottom' }] },
  }, { displayName: 'Bottom', icon: 'bottom.png' }),

  // Sin logo de marketplace: su icono es un codicon, como hacen varias extensiones.
  ext('acme.keys', {
    viewsContainers: { activitybar: [{ id: 'keysView', title: 'Keys', icon: '$(key)' }] },
    views: { keysView: [{ id: 'keysTree', name: 'Keys' }] },
  }, { displayName: 'Keys' }),

  // Secciones dentro de contenedores de fabrica: son partes, no iconos de barra.
  ext('acme.sections', {
    views: {
      explorer: [{ id: 'sectionsInExplorer', name: 'In Explorer' }],
      debug: [{ id: 'sectionsInDebug', name: 'In Debug' }],
    },
  }, { displayName: 'Sections', icon: 'sections.png' }),

  // Contenedores de depuracion de VS Code: nunca deben salir.
  ext('vendor.devtools', {
    viewsContainers: {
      activitybar: [
        { id: 'copilot-chat', title: 'Chat Debug', icon: 'mono.svg' },
        { id: 'context-inspector', title: 'Context Inspector', icon: 'mono.svg' },
      ],
    },
    views: {
      'copilot-chat': [{ id: 'chatLog', name: 'Log' }],
      'context-inspector': [{ id: 'ctxLog', name: 'Log' }],
    },
  }, { displayName: 'Dev Tools', icon: 'logo.png' }),

  // Ni una extension sin vistas (un tema, un idioma) ni el propio tablero se listan.
  ext('acme.theme', {}, { displayName: 'Theme' }),
  ext('niko.view-groups', {
    viewsContainers: { activitybar: [{ id: 'viewGroups', title: 'GG Groups', icon: 'mono.svg' }] },
    views: { viewGroups: [{ id: 'viewGroups.board', name: 'Board' }] },
  }, { displayName: 'GG Groups' }),
];
