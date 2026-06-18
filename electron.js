// electron.js — Main process
const { app, BrowserWindow, shell, ipcMain } = require("electron");
const { exec } = require("child_process");
const path = require("path");
const http = require("http");
const fs = require("fs");

const isDev = !app.isPackaged;
const PORT = 49821; // fixed high port for prod server

let mainWindow = null;
let splashWindow = null;

// ── Production file server ─────────────────────────────────────────────────
// Serves the React production build via local HTTP so BrowserRouter works.
function startProductionServer() {
  return new Promise((resolve) => {
    if (isDev) { resolve(); return; }

    const buildPath = path.join(__dirname, "build");

    const server = http.createServer((req, res) => {
      // Basic URL parsing
      const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
      let filePath = path.join(buildPath, url.pathname);

      // Default to index.html for root
      if (url.pathname === "/") {
        filePath = path.join(buildPath, "index.html");
      }

      // Serve file if it exists, otherwise fallback to index.html (for React Router)
      fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
          filePath = path.join(buildPath, "index.html");
        }

        // Basic MIME types mapping
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.json': 'application/json',
          '.png': 'image/png',
          '.jpg': 'image/jpg',
          '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon',
          '.woff': 'font/woff',
          '.woff2': 'font/woff2'
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';

        fs.readFile(filePath, (error, content) => {
          if (error) {
            res.writeHead(500);
            res.end("Server Error");
          } else {
            res.writeHead(200, { "Content-Type": contentType });
            res.end(content, "utf-8");
          }
        });
      });
    });

    server.listen(PORT, "127.0.0.1", resolve);
  });
}

// ── Splash window ──────────────────────────────────────────────────────────
function createSplash() {
  splashWindow = new BrowserWindow({
    width: 460,
    height: 280,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    center: true,
    backgroundColor: "#0a0f18",
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  splashWindow.loadFile(path.join(__dirname, "assets", "splash.html"));
}

// ── Main window ────────────────────────────────────────────────────────────
function createMain() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    center: true,
    title: "Pickleball Management System",
    icon: path.join(__dirname, "assets", "icon.png"),
    backgroundColor: "#0a0f18",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      // persist: keeps IndexedDB (Firebase offline cache) across restarts
      partition: "persist:pickleball",
    },
  });

  const url = isDev
    ? "http://localhost:3000"
    : `http://127.0.0.1:${PORT}`;

  mainWindow.loadURL(url);

  if (isDev) mainWindow.webContents.openDevTools();

  mainWindow.once("ready-to-show", () => {
    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy();
      mainWindow.show();
      mainWindow.focus();
    }, 2000);
  });

  // External links open in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url: u }) => {
    if (u.startsWith("http")) shell.openExternal(u);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => { mainWindow = null; });
}
// ── App lifecycle ──────────────────────────────────────────────────────────
ipcMain.on("print-esc-pos", (event, bufferArray) => {
  try {
    const buffer = Buffer.from(bufferArray);
    const tmpPath = path.join(app.getPath("temp"), "receipt.bin");
    fs.writeFileSync(tmpPath, buffer);
    
    // Windows RAW print to USB001 or shared printer.
    console.log("Attempting to print raw ESC/POS to TX-80 on USB001...");
    exec(`copy /b "${tmpPath}" "\\\\localhost\\TX80"`, (err1) => {
      if (err1) {
        exec(`copy /b "${tmpPath}" USB001`, (err2) => {
          if (err2) console.error("Failed to copy raw bytes to USB001:", err2);
          else console.log("Successfully printed to USB001");
        });
      } else {
        console.log("Successfully printed to \\\\localhost\\TX80");
      }
    });
  } catch (err) {
    console.error("IPC print error:", err);
  }
});

app.whenReady().then(async () => {
  createSplash();
  await startProductionServer();
  createMain();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMain();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
