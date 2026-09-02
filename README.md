<div align="center">

<img src="media/gg-groups.svg" width="112" alt="GG Groups">

# GG Groups

**Your whole activity bar in one panel — nothing hidden behind `…` ever again.**

[![tests](https://img.shields.io/badge/tests-254%20passing-2E8FE6)](test)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.74%2B-1565C0)](https://code.visualstudio.com/)
[![license](https://img.shields.io/badge/license-MIT-4FC3F7)](LICENSE)

**English** · [Español](README.es.md)

</div>

---

## The problem

Install enough extensions and VS Code's activity bar gives up. Icons start collapsing into
a `…` menu, and the ones you actually use end up buried three clicks deep. VS Code offers
no way to group them, and no extension can — the activity bar is workbench chrome, closed
to the extension API.

## What GG Groups does

It rebuilds the bar as a panel you own. **Every icon at once**, and folders you make the
obvious way: drag one icon onto another, name the folder, done.

<div align="center">

| | |
|---|---|
| **See everything** | Every sidebar container, no overflow menu |
| **Join by dragging** | Icon onto icon joins them into one. Named folders come from the button |
| **Reorder like the real bar** | Drop on an edge to place between icons, on the center to group |
| **Stack duplicates** | Icons sharing the same artwork collapse into one with a count: C/C++, its themes and its pack are one icon |
| **Rename anything** | Icons and folders, whatever makes sense to you |
| **Hide the noise** | Right-click → hide. The eye at the bottom brings them all back |
| **Work in groups** | **Ctrl+click** picks several: they drag together, turn off together, uninstall together |
| **Disabled ones stay visible** | Turn one off and it greys out at the bottom instead of vanishing, one click from coming back |
| **Update notices** | A blue dot on the ones with a new version, right-click to install it. It only queries the marketplace when you ask |
| **Two closing sections** | *Passive extensions* (installed, no bar icon, behind the eye) and *Disabled*, at the very end |
| **Native block, locked** | Explorer, Search, Source Control, Run and Debug, Extensions — pinned on top, in VS Code's own order, indestructible |

</div>

## Install

No marketplace release yet. Clone and copy it into your extensions folder:

```bash
git clone https://github.com/Niko-Vanetti/gg-groups.git
cd gg-groups
# Windows
cp -r package.json package.nls*.json extension.js media l10n ~/.vscode/extensions/gg-groups
# macOS / Linux — same path, VS Code reads ~/.vscode/extensions on all platforms
```

Then reload VS Code (`Ctrl+Shift+P` → *Developer: Reload Window*) and click the
**GG Groups** icon.

## Using it

| Gesture | What happens |
|---|---|
| **Click an icon** | Opens that extension's panel |
| **Drag icon → icon** | Joins them into a single icon with a count |
| **Right-click a stack** | Choose its icon · split the group |
| **Drag to a folder header** | Moves it in |
| **Drag to an edge** | Places it between two icons |
| **Drag to empty space** | Takes it out of its folder |
| **Ctrl+click an icon** | Adds or removes it from the selection |
| **Ctrl Ctrl · Escape** | Drops the whole selection |
| **Ctrl+click a stack** | Picks every icon under it at once |
| **Drag a picked one** | Takes every picked icon along |
| **Right-click an icon** | Update (when there's a new version) · rename · turn off · uninstall · hide |
| **Right-click ↻** | Check the marketplace for updates |
| **Right-click a folder** | Sort A–Z · rename · delete |
| **Bottom buttons** | New folder · sort all · eye (show hidden) · pause/play (turn the picked ones off or on) · trash (uninstall the picked ones) · refresh |

### Picking several

**Ctrl+click** on icons adds them to the selection. With several picked, dragging one takes
them all, and the bottom buttons act on the whole group: **pause** turns them off, **play**
turns them on, the **trash** uninstalls them.

On macOS the key is **Cmd**, since Ctrl+click is the right click there; the extension's own
text says whichever applies to your system.

To drop the selection: a normal click, **two quick taps of Ctrl**, or **Escape**. Simply
releasing the key deliberately doesn't clear it — if it did, you would have to hold Ctrl down
to press the buttons, which is exactly what you do after picking.

**Pause** and **play** are the apply button: they list what will happen, close VS Code, apply
it and open it again. One restart no matter how many you picked. Cancel and nothing happens.

Clicking a disabled extension doesn't switch it back on — it tells you it's off. Turning it
on is deliberate: pick it with Ctrl+click and press play.

The pause/play button knows which one applies: pause when everything picked is on, play when
everything is off. Mix the two and it greys out — there is no sensible action to apply to all
of them, and guessing would be worse than doing nothing.

### Keep it always visible

The primary side bar shows one container at a time, so clicking an icon replaces the board.
Move it to the **secondary side bar** and it stays put while everything else opens on the
left. GG Groups tries to do this for you on first run; if your VS Code build doesn't expose
the command, drag the icon there once — it's remembered forever.

### Actually disabling one, from a script

VS Code exposes no way for an extension to disable another, and its CLI says so of
`--disable-extension`: *"not persisted and effective only when the command opens a new
window"*. But the list itself lives in VS Code's global state database, under the key
`extensionsIdentifiers/disabled`, and that can be edited:

```bash
python scripts/gg-extensions.py list                # what you have, and what is on
python scripts/gg-extensions.py disable ms-vscode.cmake-tools vscjava.vscode-gradle
python scripts/gg-extensions.py enable --all
```

**VS Code has to be closed** — it keeps that database in memory and flushes it on exit, so
anything written while it runs is lost. The script refuses to continue if it finds VS Code
running, and takes a timestamped backup before every write.

From the board you don't have to type any of that. Pick the icons with **Ctrl+click** and
press **pause**: GG Groups lists what will happen and, once you confirm, launches a separate
process that waits for VS Code to close, writes every change at once and opens it again. One
restart for all of them, not one per extension. For a single one, right-click → **Turn
extension off** does the same.

A visible window opens and narrates what it does, and **it is the one that reopens VS
Code**: if you open it yourself too early, the script finds the editor running again and
writes nothing — writing then would be pointless, since VS Code would overwrite it on exit.
If that happens the window waits for you to close it instead of giving up. Everything is
also written to a log that `GG Groups: Check that everything works` reads back to you.

Reloading the window is not a shortcut. *Developer: Reload Window* restarts the window and
the extension host, but not VS Code's main process — the one holding that database in memory
and flushing it on exit, which would overwrite anything written before the reload. It has to
close fully.

Without Python, GG Groups doesn't pretend: it says so and leaves the whole command on your
clipboard to run by hand.

## Design decisions worth knowing

**It groups by family, not by name.** Three things are joined: whatever an extension pack
brought along — you install *Extension Pack for Java* and seven icons appear, which to you
are one thing — whatever shares the same artwork, and whatever you join yourself by dragging
one icon onto another. **The group's face is whichever brought the others** — the pack you installed, not whichever
turns up first. "Oldest one" isn't enough: *Extension Pack for Java* was installed after two
of its members, and Remote has three candidates at once. Right-click a stack to pick another
icon by hand, or to split it; both win over the automatic grouping.

**Artwork counts too.** That's what you see: C/C++, C/C++ Themes and the C/C++
pack are three different extensions sharing one logo, and in the bar they look — and are —
the same thing. They collapse into one icon with a count. The liveliest member wins: if you
keep one of an extension's three icons active, the whole group renders there instead of
hidden away with the rest. With no logo it falls back to grouping by name, as before.

**It mirrors your sidebars, and behind the eye, everything else.** The board is the bar: only
what has its own icon shows up front. Whatever you installed that contributes none — C/C++,
YAML, WSL, a theme — lives behind the eye as a **passive extension**, with its store name and
logo, and can be turned off, on and uninstalled like the rest. The bottom panel stays out:
that's not a sidebar.

The list comes from VS Code's own registry (`extensions.json`, in the folder this extension
lives in) rather than from the loaded extensions — disabled ones aren't there, and those are
exactly the ones you need to be able to switch back on. If that folder can't be derived,
there are simply no passive extensions: guessing a path would mean reading files that aren't
ours to read.

**Dead icons are filtered out.** Views behind an unmet `when` clause, containers with no
views at all, and commands VS Code hasn't registered never make it to the board. Where a
condition depends on another extension's context key — unknowable from outside — the icon
is shown rather than guessed away.

**Real icons, real drawings.** Marketplace logo first, then the extension's own sidebar
icon, then the matching official codicon (all 639 ship with the extension), and only then
a letter. Monochrome art is masked so it takes your theme's color instead of rendering black.

**It follows your OS language, not VS Code's.** English and Spanish included. On Windows the
extension host reports VS Code's locale rather than the system's, so it asks Windows directly.

**Disabling is marked, then applied in one batch.** No API lets an extension disable another,
and the workbench commands either don't exist or accept the call and quietly ignore it. The
only thing that works is writing to the state database with VS Code closed — and since closing
it is expensive, it doesn't happen once per extension: you mark them all and one restart
applies everything. Until then nothing has changed, and the board keeps telling the truth: an
icon greys out when VS Code genuinely stops loading it, however you turned it off.
Uninstalling *is* scriptable, so that one happens in place, behind a confirmation that says
plainly it deletes the extension from disk.

**Your setup is yours, and nothing is contacted without asking.** Folders, order, names,
hidden and disabled icons live in VS Code's extension storage; nothing is written to your
settings. GG Groups works entirely offline, with a single exception that only happens when
you ask for it: **Check for updates** queries the Visual Studio Marketplace — the same
endpoint and the same request VS Code itself makes — sending your extension identifiers and
nothing else. Until you press that, nothing leaves your machine.

## Verify it yourself

Run **`GG Groups: Check that everything works`** from the command palette. It walks every
tile, confirms each icon file exists on disk and each command is registered, reports whether
disabling extensions and moving to the right bar are available in your build, and checks the
saved state is coherent.

## Development

```bash
npm install
npm test      # 254 tests, no VS Code needed
```

The suite runs the real `extension.js` against a stubbed VS Code API and the real webview
inside jsdom, over a fixed set of fake extension manifests — so it gives the same result on
any machine. It covers discovery and filtering, drag and drop, folders and the locked native
block, stacking, hiding, renaming, the on/off switch, `when` evaluation, locale detection,
and every error path.

## License

MIT — see [LICENSE](LICENSE).
