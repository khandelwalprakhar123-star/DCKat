/*
 * Desktop tabby — main process.
 *
 * One transparent, always-on-top window covering the primary display. The
 * window is click-through by default; the renderer reports the cat's hitbox
 * and we flip interactivity on only while the cursor is actually over her, so
 * the rest of the screen keeps behaving like there's no window there at all.
 */
const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { encodePNG } = require('./png');
const voice = require('./voice');

const CURSOR_HZ = 30;

let win = null;
let tray = null;
let cursorTimer = null;
let hitbox = null;      // { x, y, w, h } in window-local CSS px
let interactive = false;
let held = false;       // renderer says the cat is being dragged
let lastCursor = { x: 0, y: 0 };

function geometry() {
  const d = screen.getPrimaryDisplay();
  const b = d.bounds;
  const wa = d.workArea;
  return {
    bounds: b,
    // Window-local: the cat walks along the top of the Dock, inside the menu bar.
    floor: wa.y + wa.height - b.y,
    left: wa.x - b.x,
    right: wa.x + wa.width - b.x,
    ceiling: wa.y - b.y
  };
}

function createWindow() {
  const g = geometry();
  win = new BrowserWindow({
    x: g.bounds.x,
    y: g.bounds.y,
    width: g.bounds.width,
    height: g.bounds.height,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,       // clicking the cat must never steal focus from your work
    acceptFirstMouse: true,
    roundedCorners: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: false });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.webContents.on('did-finish-load', () => {
    send('pet:geometry', geometry());
    // Dev aid: make her say something straight away so speech can be checked.
    if (process.env.PET_SAY_NOW) {
      setTimeout(() => send('pet:command', { type: 'speak' }), 900);
    }
  });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function setInteractive(next) {
  if (next === interactive || !win || win.isDestroyed()) return;
  interactive = next;
  win.setIgnoreMouseEvents(!next, { forward: false });
}

/* Poll the cursor globally: works even while the window is click-through. */
function startCursorLoop() {
  cursorTimer = setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const local = { x: p.x - b.x, y: p.y - b.y };
    const dx = local.x - lastCursor.x;
    const dy = local.y - lastCursor.y;
    lastCursor = local;

    send('pet:cursor', { x: local.x, y: local.y, dx, dy, dt: 1 / CURSOR_HZ });

    const over = hitbox &&
      local.x >= hitbox.x && local.x <= hitbox.x + hitbox.w &&
      local.y >= hitbox.y && local.y <= hitbox.y + hitbox.h;
    setInteractive(!!over || held);
  }, Math.round(1000 / CURSOR_HZ));
}

// -------------------------------------------------------------- tray icon

const ICON = [
  '................',
  '.##..........##.',
  '.###........###.',
  '.####......####.',
  '.##############.',
  '################',
  '################',
  '##.###....###.##',
  '################',
  '################',
  '#####.####.#####',
  '.##############.',
  '.##############.',
  '..############..',
  '....########....',
  '................'
];

function trayImage() {
  const size = 16;
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (ICON[y][x] !== '#') continue;
      const i = (y * size + x) * 4;
      rgba[i] = 0; rgba[i + 1] = 0; rgba[i + 2] = 0; rgba[i + 3] = 255;
    }
  }
  const img = nativeImage.createFromBuffer(encodePNG(size, size, rgba));
  img.setTemplateImage(true); // adapts to light/dark menu bar
  return img;
}

let wandering = true;
let models = [];

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: 'Come here', click: () => send('pet:command', { type: 'come', x: lastCursor.x, y: lastCursor.y }) },
    { label: 'Go to sleep', click: () => send('pet:command', { type: 'sleep' }) },
    { label: 'Say something', click: () => send('pet:command', { type: 'speak' }) },
    {
      label: 'Wander around',
      type: 'checkbox',
      checked: wandering,
      click: (item) => {
        wandering = item.checked;
        send('pet:command', { type: 'wander', on: wandering });
      }
    },
    { type: 'separator' },
    {
      label: 'Talks back',
      type: 'checkbox',
      checked: voice.isEnabled(),
      click: (item) => voice.setEnabled(item.checked)
    },
    {
      label: 'Voice model',
      submenu: models.length
        ? models.map((m) => ({
            label: m,
            type: 'radio',
            checked: m === voice.getModel(),
            click: () => { voice.setModel(m); tray.setContextMenu(buildMenu()); }
          }))
        : [{ label: 'Ollama not reachable', enabled: false }]
    },
    { type: 'separator' },
    {
      label: 'Size',
      submenu: [2, 3, 4].map((s) => ({
        label: { 2: 'Small', 3: 'Medium', 4: 'Large' }[s],
        type: 'radio',
        checked: s === 3,
        click: () => send('pet:command', { type: 'scale', scale: s })
      }))
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
}

// ------------------------------------------------------------------- boot

app.whenReady().then(() => {
  if (app.dock) app.dock.hide();   // menu-bar app, no Dock icon
  createWindow();
  startCursorLoop();

  tray = new Tray(trayImage());
  tray.setToolTip('Desktop tabby');
  tray.setContextMenu(buildMenu());

  // Populate the model list once Ollama answers (or leave it greyed out).
  voice.listModels().then((found) => {
    if (!found.length) return;
    models = found;
    if (!found.includes(voice.getModel())) voice.setModel(found[0]);
    tray.setContextMenu(buildMenu());
  });

  const refit = () => {
    if (!win || win.isDestroyed()) return;
    const g = geometry();
    win.setBounds(g.bounds);
    send('pet:geometry', g);
  };
  screen.on('display-metrics-changed', refit);
  screen.on('display-added', refit);
  screen.on('display-removed', refit);
});

/*
 * Dev aid: PET_CAPTURE=<file.png> grabs a few frames of the cat straight from
 * the window (not the screen — no recording permission, no desktop content)
 * and writes them side by side so the live render can be checked.
 */
function startCaptureSheet(file) {
  const fs = require('fs');
  const shots = [];
  const FRAMES = 4;
  const EVERY = Number(process.env.PET_CAPTURE_MS) || 850;
  let n = 0;

  const timer = setInterval(async () => {
    if (!win || win.isDestroyed() || !hitbox) return;
    // Generous headroom so a speech bubble above her is inside the crop.
    const pad = 60;
    const top = 130;
    const img = await win.webContents.capturePage({
      x: Math.max(0, Math.round(hitbox.x - pad)),
      y: Math.max(0, Math.round(hitbox.y - top)),
      width: Math.round(hitbox.w + pad * 2),
      height: Math.round(hitbox.h + top + pad)
    });
    const size = img.getSize();
    const bmp = img.getBitmap(); // BGRA
    const scale = Math.round(Math.sqrt(bmp.length / (4 * size.width * size.height))) || 1;
    shots.push({ bmp, w: size.width * scale, h: size.height * scale });
    if (++n < FRAMES) return;

    clearInterval(timer);
    const w = Math.max(...shots.map((s) => s.w));
    const h = Math.max(...shots.map((s) => s.h));
    const W = w * shots.length;
    const out = new Uint8ClampedArray(W * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < W; x++) {
        const v = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? 0x5a : 0x4a;
        const i = (y * W + x) * 4;
        out[i] = v; out[i + 1] = v; out[i + 2] = v + 6; out[i + 3] = 255;
      }
    }
    shots.forEach((s, k) => {
      for (let y = 0; y < s.h; y++) {
        for (let x = 0; x < s.w; x++) {
          const si = (y * s.w + x) * 4;
          const a = s.bmp[si + 3] / 255;
          if (a <= 0) continue;
          const di = (y * W + k * w + x) * 4;
          out[di] = s.bmp[si + 2] * a + out[di] * (1 - a);
          out[di + 1] = s.bmp[si + 1] * a + out[di + 1] * (1 - a);
          out[di + 2] = s.bmp[si] * a + out[di + 2] * (1 - a);
        }
      }
    });
    fs.writeFileSync(file, encodePNG(W, h, out));
    console.log('capture written:', file, W + 'x' + h);
  }, EVERY);
}

ipcMain.on('pet:hitbox', (_e, box) => {
  hitbox = box;
  if (process.env.PET_CAPTURE && !startCaptureSheet.started) {
    startCaptureSheet.started = true;
    startCaptureSheet(process.env.PET_CAPTURE);
  }
});
ipcMain.on('pet:held', (_e, v) => { held = !!v; });
ipcMain.handle('pet:say', (_e, { trigger, ctx }) => voice.say(trigger, ctx));

app.on('window-all-closed', (e) => e.preventDefault()); // tray app: keep running
app.on('before-quit', () => clearInterval(cursorTimer));
