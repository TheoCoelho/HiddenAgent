const { app, BrowserWindow, Menu, globalShortcut, ipcMain, safeStorage, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const ai = require('./ai');

// A pasta de dados do Electron deriva do nome do app. Mantém a antiga ("bloco-notas-privado")
// para não perder as notas e chaves já salvas depois de renomear o projeto para HiddenAgent.
app.setPath('userData', path.join(app.getPath('appData'), 'bloco-notas-privado'));

const SHORTCUT = 'CommandOrControl+Alt+H';
const DEFAULTS = { text: '', opacity: 0.92, provider: 'anthropic', models: {}, bounds: { width: 380, height: 460 } };

let win = null;
let captureProtected = true; // sempre começa protegida; não é persistida de propósito
let currentAsk = null; // AbortController da pergunta em andamento

const storeFile = () => path.join(app.getPath('userData'), 'notas.json');
// `provider` sempre vem de ai.isProvider(), nunca direto de texto recebido, para não montar caminhos arbitrários.
const keyFile = (provider) => path.join(app.getPath('userData'), `chave-${provider}.bin`);

function readStore() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(storeFile(), 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeStore(patch) {
  try {
    fs.writeFileSync(storeFile(), JSON.stringify({ ...readStore(), ...patch }));
  } catch (err) {
    console.error('Falha ao salvar:', err);
  }
}

function currentProvider() {
  const { provider } = readStore();
  return ai.isProvider(provider) ? provider : DEFAULTS.provider;
}

// Lê a chave salva no app. Devolve null se não existir ou se não puder ser descriptografada
// (por exemplo, se o app foi encerrado à força antes de o Electron gravar a chave de criptografia).
function readStoredKey(provider) {
  try {
    return safeStorage.decryptString(fs.readFileSync(keyFile(provider)));
  } catch {
    return null;
  }
}

// A chave salva no app (criptografada via DPAPI) tem prioridade sobre a variável de ambiente.
function loadApiKey(provider) {
  return readStoredKey(provider) || process.env[ai.PROVIDERS[provider].envKey] || null;
}

function keySource(provider) {
  if (readStoredKey(provider)) return 'app';
  return process.env[ai.PROVIDERS[provider].envKey] ? 'env' : null;
}

function aiStatus() {
  return {
    provider: currentProvider(),
    providers: ai.describeProviders(readStore().models).map((p) => ({ ...p, keySource: keySource(p.id) })),
  };
}

// Evita abrir a janela fora da tela se o monitor anterior não existir mais.
function isOnScreen(b) {
  if (b.x === undefined || b.y === undefined) return false;
  return screen.getAllDisplays().some(({ workArea: a }) =>
    b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y);
}

function createWindow() {
  const store = readStore();
  const b = store.bounds;

  win = new BrowserWindow({
    width: b.width,
    height: b.height,
    ...(isOnScreen(b) ? { x: b.x, y: b.y } : {}),
    minWidth: 240,
    minHeight: 180,
    frame: false,
    skipTaskbar: true, // sem ícone na barra de tarefas; o acesso é pelo atalho global
    show: false,
    backgroundColor: '#1e1f22',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // Aplica antes de mostrar a janela, para nunca aparecer na captura nem por um frame.
  win.setContentProtection(captureProtected);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setOpacity(store.opacity);

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  // Com --oculto (usado na inicialização do Windows) a janela só aparece pelo Ctrl+Alt+H.
  win.once('ready-to-show', () => { if (!process.argv.includes('--oculto')) win.show(); });
  win.on('resized', saveBounds);
  win.on('moved', saveBounds);
  win.on('closed', () => { win = null; });

  win.loadFile('index.html');
}

function saveBounds() {
  if (win && !win.isMinimized()) writeStore({ bounds: win.getBounds() });
}

function toggleVisibility() {
  if (!win) return;
  if (win.isVisible() && !win.isMinimized()) {
    win.hide();
  } else {
    win.show();
    win.restore();
    win.focus();
    win.webContents.focus();
  }
}

// ---- IPC ----
ipcMain.handle('state:get', () => {
  const { text, opacity } = readStore();
  return { text, opacity, captureProtected };
});
ipcMain.on('notes:save', (_e, text) => {
  if (typeof text === 'string') writeStore({ text });
});
ipcMain.on('window:opacity', (_e, value) => {
  const opacity = Math.min(1, Math.max(0.3, Number(value) || DEFAULTS.opacity));
  win?.setOpacity(opacity);
  writeStore({ opacity });
});
ipcMain.handle('protection:toggle', () => {
  captureProtected = !captureProtected;
  win?.setContentProtection(captureProtected);
  return captureProtected;
});
ipcMain.handle('ai:status', () => aiStatus());

ipcMain.handle('ai:set-provider', (_e, provider) => {
  if (ai.isProvider(provider)) writeStore({ provider });
  return aiStatus();
});

ipcMain.handle('ai:set-model', (_e, provider, model) => {
  if (ai.isModel(provider, model)) writeStore({ models: { ...readStore().models, [provider]: model } });
  return aiStatus();
});

ipcMain.handle('ai:set-key', (_e, provider, key) => {
  if (!ai.isProvider(provider)) return { ok: false, error: 'Provedor desconhecido.' };
  const value = typeof key === 'string' ? key.trim() : '';
  if (value.length < 20) return { ok: false, error: 'Chave inválida.' };
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: `Criptografia indisponível neste sistema. Use a variável ${ai.PROVIDERS[provider].envKey}.` };
  }
  try {
    fs.writeFileSync(keyFile(provider), safeStorage.encryptString(value));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Não foi possível salvar a chave: ${err.message}` };
  }
});

ipcMain.handle('ai:clear-key', (_e, provider) => {
  if (ai.isProvider(provider)) {
    try { fs.rmSync(keyFile(provider), { force: true }); } catch { /* nada a remover */ }
  }
  return aiStatus();
});

ipcMain.on('ai:ask', async (event, payload) => {
  if (event.sender !== win?.webContents) return;
  const send = (channel, data) => { if (win && !win.isDestroyed()) win.webContents.send(channel, data); };

  if (currentAsk) return send('ai:error', 'Aguarde a resposta atual terminar.');
  const messages = ai.prepareMessages(payload?.messages);
  if (!messages) return send('ai:error', 'Pergunta inválida.');
  const provider = currentProvider();
  const apiKey = loadApiKey(provider);
  if (!apiKey) return send('ai:error', `Nenhuma chave da ${ai.PROVIDERS[provider].label} configurada.`);

  const controller = new AbortController();
  currentAsk = controller;
  try {
    await ai.streamAnswer({
      provider,
      model: readStore().models?.[provider],
      apiKey,
      messages,
      notes: payload.includeNotes ? String(payload.notes ?? '') : '',
      signal: controller.signal,
      onText: (text) => send('ai:chunk', text),
    });
    // O SDK da OpenAI encerra o streaming sem erro quando cancelado; o da Anthropic lança.
    send('ai:done', { aborted: controller.signal.aborted });
  } catch (err) {
    if (controller.signal.aborted) send('ai:done', { aborted: true });
    else send('ai:error', ai.friendlyError(err, provider));
  } finally {
    currentAsk = null;
  }
});

ipcMain.on('ai:abort', () => currentAsk?.abort());

// Sem ícone na barra não há como restaurar uma janela minimizada, então "minimizar" oculta (Ctrl+Alt+H traz de volta).
ipcMain.on('window:minimize', () => win?.hide());
ipcMain.on('window:quit', () => app.quit());

// ---- ciclo de vida ----
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (win && !argv.includes('--oculto')) {
      win.show();
      win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    createWindow();
    globalShortcut.register(SHORTCUT, toggleVisibility);
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => app.quit());
}
