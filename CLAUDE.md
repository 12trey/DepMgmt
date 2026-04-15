# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Web-based replacement for the PSADT (PowerShell App Deployment Toolkit) "Master Wrapper". Users generate, configure, and execute PSADT deployment packages through a browser UI instead of manually editing PowerShell scripts. Supports both PSADT v3 and v4.1.x. Can run as a web app or a standalone Electron desktop app.

## Commands

```bash
# Development (web)
npm run dev              # Start both backend (port 4000) and frontend (port 3000)
npm run dev:server       # Backend only (nodemon)
npm run dev:client       # Frontend only (Vite)

# Development (Electron)
npm run electron:dev     # Start backend, frontend, and Electron window

# Production build
npm run build:client     # Build React app to client/dist/
npm start                # Start Express server (serves built client)

# Electron packaging
npm run electron:build   # Build client + package as Electron installer (NSIS/portable)
npm run electron:pack    # Build client + package as unpacked Electron directory
```

Client dependencies are managed separately: `cd client && npm install`

## Architecture

- **Frontend:** React 18 + Vite + Tailwind CSS + React Router
- **Backend:** Node.js / Express on port 4000, REST API at `/api/*`
- **Real-time:** WebSocket at `/ws/logs` for execution log streaming
- **Templating:** Handlebars generates PowerShell scripts from version-specific templates
- **Desktop:** Electron wraps the app; main process at `electron/main.js` spawns Express in production
- **Platform:** Windows-focused

### Project layout

```
server/
  routes/         — Express route definitions
  controllers/    — Request handling
  services/       — Business logic (packageService, executionService, gitService, logStream)
client/
  src/pages/      — React pages (Dashboard, CreatePackage, ManagePackages, PackageDetail, Execution, GitPanel, Config)
  src/hooks/      — useWebSocket hook for log streaming
  src/api.js      — All API client functions
electron/
  main.js         — Electron main process
  preload.js      — Context bridge
templates/
  v3/             — PSADT v3 Handlebars templates (Deploy-Application.ps1.hbs, AppDeployToolkitConfig.xml.hbs)
  v4/             — PSADT v4.1.x templates (Invoke-AppDeployToolkit.ps1.hbs, Config.psd1.hbs)
```

### PSADT version differences

- **v3:** Entry script is `Deploy-Application.ps1`, dot-sources `AppDeployToolkitMain.ps1`. Cmdlets: `Show-InstallationWelcome`, `Execute-Process`, `Show-InstallationProgress`, `Exit-Script`, `Write-Log`.
- **v4.1.x:** Entry script is `Invoke-AppDeployToolkit.ps1`, imports `PSAppDeployToolkit` module. Cmdlets use `ADT` prefix: `Open-ADTSession`, `Close-ADTSession`, `Show-ADTInstallationWelcome`, `Start-ADTProcess`, `Set-ADTInstallPhase`, `Write-ADTLogEntry`.
- Version selection is stored in package metadata as `psadtVersion` (`"v3"` or `"v4"`). The backend uses `packageService.getEntryScript()` to resolve the correct script path for execution.

### Key subsystems

- **Package Builder** — form-driven UI generates PSADT packages with version-appropriate scripts
- **File Management** — upload installers, stored at `packages/{appName}/{version}/Files/`
- **Execution Engine** — runs deployments via `child_process.spawn`, streams stdout/stderr over WebSocket
- **Git Integration** — clone/pull/push a configurable PSADT package repository
- **Master Wrapper** — chains multiple installs into a single ordered deployment sequence

## Configuration

`config.json` at project root holds runtime settings: repository URL/path, packages base path, server port, PowerShell executable path, and default execution arguments.

## Constraints

- Windows environment required
- No external proprietary tool dependencies
- Configuration lives in `config.json`
- Vite dev server proxies `/api` and `/ws` to Express on port 4000
