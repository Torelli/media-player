import { app, BrowserWindow, shell, ipcMain, IpcMainInvokeEvent } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { update } from './update'
import { execSync } from 'node:child_process'
import Track from '@/model/Track'
import Player from '@/model/Player'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬ dist-electron
// │ ├─┬ main
// │ │ └── index.js    > Electron-Main
// │ └─┬ preload
// │   └── index.mjs   > Preload-Scripts
// ├─┬ dist
// │ └── index.html    > Electron-Renderer
//
process.env.APP_ROOT = path.join(__dirname, '../..')

export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

// Disable GPU Acceleration for Windows 7
if (os.release().startsWith('6.1')) app.disableHardwareAcceleration()

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let win: BrowserWindow | null = null
const preload = path.join(__dirname, '../preload/index.mjs')
const indexHtml = path.join(RENDERER_DIST, 'index.html')

async function createWindow() {
  win = new BrowserWindow({
    transparent: true,
    frame: false,
    icon: path.join(process.env.VITE_PUBLIC, 'favicon.ico'),
    webPreferences: {
      preload,
      // Warning: Enable nodeIntegration and disable contextIsolation is not secure in production
      // nodeIntegration: true,

      // Consider using contextBridge.exposeInMainWorld
      // Read more on https://www.electronjs.org/docs/latest/tutorial/context-isolation
      // contextIsolation: false,
    },
  })

  if (VITE_DEV_SERVER_URL) { // #298
    win.loadURL(VITE_DEV_SERVER_URL)
    // Open devTool if the app is not packaged
    // win.webContents.openDevTools()
  } else {
    win.loadFile(indexHtml)
  }

  // Test actively push message to the Electron-Renderer
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())

  })


  // Make all links open with the browser, not with the application
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })

  // Auto update
  update(win)
}

function handleListPlayers() {
  const playerNames = new TextDecoder('UTF-8').decode(execSync("playerctl --list-all")).split(os.EOL).filter(v => v != "")
  const players: Player[] = []
  for (let playerName of playerNames) {
    const status = new TextDecoder('UTF-8').decode(execSync(`playerctl status -p ${playerName}`))
    const volume = Number(new TextDecoder('UTF-8').decode(execSync(`playerctl volume -p ${playerName}`)))
    if (status !== "Stopped\n" && playerName.split(".")[0] !== "kdeconnect") {
      players.push({
        name: playerName,
        status,
        volume
      })
    }

  }
  return players
}

function handleCurrentTrack(_event: IpcMainInvokeEvent, player: Player) {
  if (player.name === "vlc") {
    return {
      title: new TextDecoder('UTF-8').decode(execSync(`playerctl metadata xesam:title -p ${player.name}`)),
      artist: "Unknow",
      artUrl: "",
      length: new TextDecoder('UTF-8').decode(execSync(`playerctl metadata --format "{{ duration(mpris:length) }}" -p ${player.name}`)),
      status: new TextDecoder('UTF-8').decode(execSync(`playerctl status -p ${player.name}`)),
      position: "0:00"
    }
  }

  if (player.name === "chromium" && player.status === "Stopped\n" || player.name === undefined) {
    return {
      title: "",
      artist: "",
      artUrl: "",
      length: "0:00",
      status: "",
      position: "0:00"
    }
  }
  const track: Track = {
    title: new TextDecoder('UTF-8').decode(execSync(`playerctl metadata xesam:title -p ${player.name}`)),
    artist: new TextDecoder('UTF-8').decode(execSync(`playerctl metadata xesam:artist -p ${player.name}`)),
    artUrl: new TextDecoder('UTF-8').decode(execSync(`playerctl metadata mpris:artUrl -p ${player.name}`)),
    length: new TextDecoder('UTF-8').decode(execSync(`playerctl metadata --format "{{ duration(mpris:length) }}" -p ${player.name}`)),
    status: new TextDecoder('UTF-8').decode(execSync(`playerctl status -p ${player.name}`)),
    position: new TextDecoder('UTF-8').decode(execSync(`playerctl metadata --format "{{ duration(position) }}" -p ${player.name}`))
  }
  return track
}

function handlePlayPause(_event: IpcMainInvokeEvent, player: string) {
  execSync(`playerctl play-pause -p ${player}`)
}

function handleNext(_event: IpcMainInvokeEvent, player: string) {
  execSync(`playerctl next -p ${player}`)
}

function handlePrev(_event: IpcMainInvokeEvent, player: string) {
  execSync(`playerctl previous -p ${player}`)
}

function handlePosition(_event: IpcMainInvokeEvent, player: string, position: string) {
  execSync(`playerctl position ${position} -p ${player}`)
}

function handleSetVolume(_event: IpcMainInvokeEvent, player: string, volume: number) {
  execSync(`playerctl volume ${volume} -p ${player}`)
}

app.whenReady().then(() => {
  ipcMain.handle('list-players', handleListPlayers)
  ipcMain.handle('get-current-track', handleCurrentTrack)
  ipcMain.handle('play-pause', handlePlayPause)
  ipcMain.handle('next', handleNext)
  ipcMain.handle('prev', handlePrev)
  ipcMain.handle('change-position', handlePosition)
  ipcMain.handle('set-player-volume', handleSetVolume)
  createWindow()
})

app.on('window-all-closed', () => {
  win = null
  if (process.platform !== 'darwin') app.quit()
})

app.on('second-instance', () => {
  if (win) {
    // Focus on the main window if the user tried to open another
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('activate', () => {
  const allWindows = BrowserWindow.getAllWindows()
  if (allWindows.length) {
    allWindows[0].focus()
  } else {
    createWindow()
  }
})

// New window example arg: new windows url
ipcMain.handle('open-win', (_, arg) => {
  const childWindow = new BrowserWindow({
    webPreferences: {
      preload,
      nodeIntegration: true,
      contextIsolation: false,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    childWindow.loadURL(`${VITE_DEV_SERVER_URL}#${arg}`)
  } else {
    childWindow.loadFile(indexHtml, { hash: arg })
  }
})
