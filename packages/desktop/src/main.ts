import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  shell,
  type MenuItemConstructorOptions,
} from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

let serverProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let projectRoot: string | null = null;

app.setName('Winnow');

function resolveProjectFromArgv(): string | undefined {
  const arg = process.argv.find((item) => item.startsWith('--project='));
  if (arg) return arg.split('=')[1];
  return process.env.WINNOW_PROJECT;
}

function isProject(directory: string): boolean {
  return existsSync(path.join(directory, '.winnow', 'project.json'));
}

async function chooseProject(): Promise<string | undefined> {
  const result = await dialog.showOpenDialog({
    title: 'Open a Winnow project',
    properties: ['openDirectory'],
  });
  const directory = result.filePaths[0];
  if (result.canceled || !directory) return undefined;
  if (!isProject(directory)) {
    await dialog.showMessageBox({
      type: 'error',
      message: 'That folder is not a Winnow project.',
      detail: 'Run `winnow init <name>` first, then choose the project folder.',
    });
    return chooseProject();
  }
  return directory;
}

function startServer(root: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const serverPath = path.resolve(__dirname, '../../server/dist/index.js');
    if (!existsSync(serverPath)) {
      reject(new Error('Server build not found. Run `npm run build` first.'));
      return;
    }

    const child = spawn(process.execPath, [serverPath, `--project=${root}`], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        WINNOW_PORT: '0',
        WINNOW_READY_JSON: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProcess = child;

    let settled = false;
    let buffer = '';
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error('Timed out starting the local server'));
    }, 15_000);

    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const match = line.match(/WINNOW_READY (\{.*\})/);
        if (!match || settled) continue;
        settled = true;
        clearTimeout(timer);
        try {
          const ready = JSON.parse(match[1]!) as { port: number };
          resolve(ready.port);
        } catch (error) {
          reject(error);
        }
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      console.error('winnow server:', chunk.toString());
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Local server exited with code ${code}`));
    });
  });
}

async function createWindow(port: number): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Winnow',
    backgroundColor: '#0b0f0d',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}/`);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function openProject(root: string): Promise<void> {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  projectRoot = root;
  const port = await startServer(root);
  if (mainWindow) {
    await mainWindow.loadURL(`http://127.0.0.1:${port}/`);
  } else {
    await createWindow(port);
  }
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Project…',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const directory = await chooseProject();
            if (directory) await openProject(directory);
          },
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  try {
    buildMenu();
    const explicit = resolveProjectFromArgv();
    const root = explicit && isProject(explicit) ? explicit : await chooseProject();
    if (!root) {
      app.quit();
      return;
    }
    await openProject(root);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && projectRoot) {
        void openProject(projectRoot);
      }
    });
  } catch (error) {
    await dialog.showMessageBox({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  serverProcess?.kill();
  serverProcess = null;
});
