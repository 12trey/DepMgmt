# PSADT for DMT

A modern, web-based desktop application for building, managing, and deploying
[PowerShell App Deployment Toolkit (PSADT)](https://psappdeploytoolkit.com/) packages — plus a suite of Windows
IT administration tools. Runs as a standalone **Electron** desktop app or as a
browser-accessible **web application**.

---

## Overview

PSADT for DMT replaces the old "edit PowerShell scripts by hand" workflow with a
clean browser UI. It supports both PSADT **v3** and **v4.1.x**, generates
version-appropriate scripts from Handlebars templates, streams live execution
output over WebSocket, and bundles several Windows administration tools under
one roof.

---

## Features

### Package Builder

- Form-driven interface for creating PSADT deployment packages
- **PSADT v3** and **v4.1.x** support — select the version per package; scripts
  and cmdlets are generated accordingly
- Fields for application name, version, vendor, architecture, install / uninstall /
  repair commands, close-applications list, and default deploy mode
- **Drag-and-drop installer auto-fill** — drop an `.msi` or `.exe` onto the
  Commands panel to auto-populate install/uninstall commands with the correct
  syntax for the selected PSADT version; the installer is automatically uploaded
  to the package's `Files\` folder on save
- Detection rule builder: file path, registry key/value, MSI product code, or
  custom PowerShell script
- Pre-install and post-install step editor (description + PowerShell command pairs)
- Deployment conditions (OS version, architecture, custom)

### Package Management

- Browse, search, and filter all packages in the packages directory
- View package details, edit any field, and regenerate scripts on demand
- File manager per package: upload additional files, delete files, and detect
  missing installer references
- Import existing PSADT packages from the filesystem
- Delete packages with confirmation

### Script Generation

- Handlebars template engine generates version-appropriate scripts:
  - **v3:** `Deploy-Application.ps1` + `AppDeployToolkitConfig.xml`
  - **v4:** `Invoke-AppDeployToolkit.ps1` + `Config.psd1`
- Scripts are regenerated on every save or on demand

### Execution Engine

- Run packages locally or on a **remote target** via WinRM
  - Remote execution copies package files to a temp directory, runs the
    deployment, then cleans up
  - Optional username / password for WinRM authentication
- **Master Wrapper** — chain multiple packages into a single ordered deployment
  sequence with per-step install/uninstall/repair and mode selection
- Three deployment modes: Silent, Interactive, NonInteractive
- Real-time **WebSocket log streaming** — stdout and stderr colour-coded in a
  live terminal panel
- Execution history with status badges (Running / Success / Failed) and a
  full log viewer modal

### MSI Builder

- Build custom Windows Installer (`.msi`) packages from scratch using WiX v3
- **Drag-and-drop MSI probing** — drop an existing `.msi` to auto-fill product
  name, manufacturer, version, upgrade code, product code, and platform
- **Multi-destination file tree** — install files to any system location, not
  just `INSTALLDIR`:
  - Predefined WiX directories: `ProgramData`, `Windows`, `System32`,
    `System64`, `Common Files`, `Fonts`, `AppData`, `LocalAppData`, `Temp`,
    and more
  - Custom absolute paths via `<SetProperty>`
  - Scope filtering — per-user installs restrict destinations to user-profile
    folders; per-machine installs allow system directories
- **Drag-and-drop folder import** — drag an entire folder onto the file tree to
  recursively recreate the folder structure (handles >100 files per directory
  via batched `readEntries`)
- Inline folder renaming — double-click any folder to rename it in place
- **Windows Service support** — mark any `.exe` as a Windows service with full
  property editing: service name, display name, description, startup type
  (automatic/manual/disabled), error control, Log On As account
  (LocalSystem / LocalService / NetworkService / custom), and
  install/start/stop/remove actions
- Registry editor with expandable entry views
- Auto-detects WiX toolset; surfaces install instructions if missing

### Intune Win32 Packager

- Create `.intunewin` packages using Microsoft's **IntuneWinAppUtil.exe**
- **Automatic tool management** — checks for a cached copy of
  `IntuneWinAppUtil.exe` on startup; if missing, downloads the latest release
  from the official
  [Microsoft GitHub repository](https://github.com/microsoft/microsoft-win32-content-prep-tool)
  with live download progress
- Form fields for setup folder, source setup file, and output folder with
  native folder/file picker dialogs (Electron) or typed paths (browser)
- Options: quiet mode (`-q`) and catalog folder (`-a`)
- Live command preview showing the exact command that will run
- Real-time build output streamed to an embedded terminal

### Manage Groups

- Manage Windows **local groups** and **Active Directory domain groups** from
  one UI
- Groups are configured on the Settings page with verification before adding —
  the backend queries PowerShell to confirm the group exists
- **Searchable, scrollable group sidebar** — groups sorted alphabetically with
  a real-time filter box (startsWith match as you type)
- **Add user workflow:**
  1. Enter a username or SAM account name
  2. Click "Verify User" — PowerShell confirms the account exists and returns
     display name, email, enabled status
  3. Detects if the user is already a member
  4. Confirm to add
- **Remove user workflow:**
  1. Click "Remove" on any member row — backend re-verifies membership before
     proceeding
  2. Inline confirmation expands with the user's details
  3. Confirm to remove
- **Privileged account support** — enter an AD privileged account
  (username + password) that is used for all AD operations when the current
  session account lacks sufficient rights; credentials are **session-persistent**
  (survive page navigation) but never written to disk; show/hide password toggle

### Git Integration

- Clone, pull, push, and view log for a configurable PSADT package repository
- Publish individual packages to the repository
- Displays current status and recent commit history

### DMT Tools

- Additional Windows IT management tooling integrated into the same app shell

### Settings

- Repository URL and local path
- Packages base directory
- Server port
- PowerShell executable path
- **Active Directory domain** name for AD group operations
- **Managed groups list** — add local or domain groups with live verification;
  these groups populate the Manage Groups page

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS, React Router, Lucide icons |
| Backend | Node.js, Express 4 |
| Real-time | WebSocket (`ws`) |
| Templating | Handlebars |
| Desktop | Electron 41 |
| MSI build | WiX v3 toolset (external) |
| Intune packaging | IntuneWinAppUtil (auto-downloaded) |
| Group management | PowerShell (`Get/Add/Remove-LocalGroupMember`, AD cmdlets) |
| Git | simple-git |

---

## Project Structure

```
aipsadt/
├── client/                  # React frontend (Vite)
│   └── src/
│       ├── context/         # AdCredentialContext (session-persistent AD creds)
│       ├── hooks/           # useWebSocket
│       ├── pages/           # One file per page/feature
│       └── api.js           # All API client functions
├── electron/
│   ├── main.js              # Electron main process, IPC handlers
│   └── preload.js           # Context bridge (pickFolder, pickFile)
├── server/
│   ├── controllers/         # Request handlers
│   ├── routes/              # Express route definitions
│   ├── services/            # Business logic
│   │   ├── executionService.js
│   │   ├── groupService.js
│   │   ├── intuneService.js
│   │   ├── logStream.js
│   │   ├── msiService.js
│   │   └── packageService.js
│   ├── index.js             # Express app + WebSocket server
│   └── paths.js             # Path resolution (dev vs packaged)
├── templates/
│   ├── v3/                  # PSADT v3 Handlebars templates
│   └── v4/                  # PSADT v4.1.x Handlebars templates
└── config.json              # Runtime configuration
```

---

## Setup

### Prerequisites

- **Node.js** 18 or later
- **Windows** (required for PSADT execution and group management)
- **WiX Toolset v3.14** — required only for MSI Builder
  (`candle.exe` and `light.exe` must be on PATH or in `C:\Program Files (x86)\WiX Toolset*`)

### Install dependencies

```bash
# Root (backend + Electron)
npm install

# Frontend
cd client && npm install
```

### Development

```bash
# Web (backend on :4000, frontend on :3000 with proxy)
npm run dev

# Electron desktop app
npm run electron:dev
```

### Production build

```bash
# Build React client
npm run build:client

# Serve via Express (web mode)
npm start

# Package as Electron installer (NSIS + portable)
npm run electron:build

# Package as unpacked directory
npm run electron:pack
```

---

## Configuration

Edit `config.json` in the project root (or `%APPDATA%\DMTPSADT\config.json` when
packaged):

```json
{
  "repository": {
    "url": "https://github.com/your-org/psadt-packages.git",
    "localPath": "./repo"
  },
  "packages": {
    "basePath": "./packages"
  },
  "server": {
    "port": 4000
  },
  "execution": {
    "powershellPath": "powershell.exe",
    "defaultArgs": ["-NoProfile", "-ExecutionPolicy", "Bypass"]
  },
  "groups": {
    "adDomain": "contoso.com",
    "managedGroups": [
      { "name": "Administrators", "type": "local" },
      { "name": "Domain Admins",  "type": "domain" }
    ]
  }
}
```

---

## API Reference

All endpoints are under `/api`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/packages` | List all packages |
| POST | `/packages` | Create a package |
| GET | `/packages/:app/:ver` | Get package detail |
| PUT | `/packages/:app/:ver` | Update package |
| DELETE | `/packages/:app/:ver` | Delete package |
| POST | `/packages/:app/:ver/regenerate` | Regenerate scripts |
| POST | `/packages/:app/:ver/upload` | Upload files |
| GET | `/packages/:app/:ver/files` | List uploaded files |
| DELETE | `/packages/:app/:ver/files/:name` | Delete a file |
| POST | `/execution/run` | Run a package (local or remote) |
| POST | `/execution/run-wrapper` | Run master wrapper sequence |
| GET | `/execution/logs` | List execution history |
| GET | `/execution/logs/:id` | Get a specific log |
| GET | `/git/status` | Git status |
| POST | `/git/clone` | Clone repository |
| POST | `/git/pull` | Pull latest |
| POST | `/git/push` | Push changes |
| GET | `/msi/detect-tools` | Check WiX installation |
| POST | `/msi/probe` | Extract metadata from an MSI |
| POST | `/msi/build` | Build an MSI package |
| GET | `/intune/status` | Check IntuneWinAppUtil cache |
| POST | `/intune/download` | Download IntuneWinAppUtil |
| POST | `/intune/build` | Create .intunewin package |
| POST | `/groups/verify-group` | Verify a group exists |
| POST | `/groups/members` | List group members |
| POST | `/groups/verify-user` | Verify a user exists |
| POST | `/groups/add-user` | Add user to group |
| POST | `/groups/remove-user` | Remove user from group |
| GET | `/config` | Get configuration |
| PUT | `/config` | Update configuration |

WebSocket log streaming is available at `ws://localhost:4000/ws/logs`.
Send `{ "subscribe": "<executionId>" }` to filter messages to a specific run.

---

## PSADT Version Reference

| Feature | v3 | v4.1.x |
|---|---|---|
| Entry script | `Deploy-Application.ps1` | `Invoke-AppDeployToolkit.ps1` |
| Config file | `AppDeployToolkitConfig.xml` | `Config.psd1` |
| Install prompt | `Show-InstallationWelcome` | `Show-ADTInstallationWelcome` |
| Run process | `Execute-Process` | `Start-ADTProcess` |
| Run MSI | `Execute-MSI` | `Start-ADtMsiProcess` |
| Log entry | `Write-Log` | `Write-ADTLogEntry` |
| Progress dialog | `Show-InstallationProgress` | `Show-ADTInstallationProgress` |

---

## License

MIT
