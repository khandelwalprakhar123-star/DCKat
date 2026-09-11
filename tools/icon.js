/*
 * Renders the 1024x1024 app icon from the cat's own art.
 * Usage: npx electron tools/icon.js [out.png]   (default: Resources/icon.png)
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const out = process.argv[2] && !process.argv[2].startsWith('-')
  ? process.argv[2]
  : path.join(__dirname, '..', 'Resources', 'icon.png');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1100,
    height: 1100,
    webPreferences: { nodeIntegration: false, contextIsolation: true, offscreen: true }
  });

  await win.loadFile(path.join(__dirname, 'icon.html'));
  const dataURL = await win.webContents.executeJavaScript('window.__icon');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(dataURL.split(',')[1], 'base64'));
  console.log('wrote', out);
  app.quit();
});
