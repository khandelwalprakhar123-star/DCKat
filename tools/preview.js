/*
 * Renders every pose to a contact sheet so the art can be checked without
 * hunting for the cat on screen.  Usage: npm run preview [out.png]
 *
 * Runs under Electron because the art is canvas-based — there's no canvas in
 * plain Node.
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const out = process.argv[2] && !process.argv[2].startsWith('-')
  ? process.argv[2]
  : path.join(__dirname, '..', 'preview.png');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 900,
    webPreferences: { nodeIntegration: false, contextIsolation: true, offscreen: true }
  });

  await win.loadFile(path.join(__dirname, 'preview.html'));
  const dataURL = await win.webContents.executeJavaScript('window.__sheet');
  fs.writeFileSync(out, Buffer.from(dataURL.split(',')[1], 'base64'));
  console.log('wrote', out);
  app.quit();
});
