You are a senior full-stack engineer. Build a complete production-ready application that replicates and modernizes the functionality of a PSADT (PowerShell App Deployment Toolkit) “Master Wrapper”, but implemented as a web-based system using Node.js and React.

## High-Level Goal

Create a web UI that allows users to generate, configure, and execute PSADT deployment packages without manually editing PowerShell scripts.

## Architecture Requirements

* Frontend: React (with hooks, functional components)
* Backend: Node.js with Express
* Communication: REST API
* File handling: Server-side filesystem operations
* Platform: Windows-focused (must support PSADT workflows)
* Optional: Support running commands inside WSL if needed

## Core Features

### 1. Package Builder UI

* Form-driven interface to define:

  * Application name
  * Version
  * Vendor
  * Install command
  * Uninstall command
  * Repair command
  * Detection logic (file, registry, MSI, custom script)
* Allow dynamic addition of:

  * Pre-install steps
  * Post-install steps
  * Conditions (OS version, architecture, etc.)

### 2. Script Generation Engine

* Backend dynamically generates:

  * Deploy-Application.ps1
  * AppDeployToolkitConfig.xml (or JSON equivalent)
* Must follow PSADT conventions and structure
* Template-based generation system (use handlebars or similar)

### 3. File Management

* Upload installer files (.exe, .msi, .ps1, etc.)
* Store them in structured directories:
  /packages/{appName}/{version}/
* Allow browsing and editing existing packages

### 4. Execution Engine

* Trigger deployments directly from UI
* Show real-time logs/output (stream stdout/stderr)
* Support:

  * Silent install
  * Interactive install
* Use child_process.spawn for execution

### 5. Logging & Monitoring

* Real-time log streaming to frontend (WebSockets or SSE)
* Persist logs per deployment
* Display status:

  * Pending
  * Running
  * Success
  * Failed

### 6. Git Integration

* Allow cloning/pulling a repository containing PSADT packages
* Configurable repo URL in a config file
* UI button for:

  * Clone
  * Pull latest
  * Push changes

### 7. Configuration System

* Use a config.json file for:

  * Repository URL
  * Default paths
  * Execution settings

### 8. Master Wrapper Behavior

* Ability to chain multiple installs into a single deployment
* Define execution order
* Conditional branching (optional advanced feature)

## UI/UX Requirements

* Clean, modern UI (use a component library like Material UI or Tailwind)
* Sections:

  * Dashboard
  * Create Package
  * Manage Packages
  * Execution / Logs
* Include:

  * Progress indicators
  * Status badges
  * Search/filter for packages

## Technical Requirements

* Use async/await throughout
* Proper error handling
* Modular backend structure:

  * routes/
  * services/
  * controllers/
* Secure file handling (sanitize inputs)
* CORS support if needed

## Bonus Features (if possible)

* Role-based access control
* Package export/import (zip)
* Detection rule builder UI
* PowerShell script preview/editing
* REST API documentation (Swagger)

## Deliverables

* Full backend code (Node.js)
* Full frontend code (React)
* Example generated PSADT package
* README with setup instructions
* Sample config.json

## Constraints

* Do NOT rely on external proprietary tools
* Must work on Windows environment
* Code should be clear, maintainable, and extensible

## Output Format

Provide:

1. Project folder structure
2. Backend implementation
3. Frontend implementation
4. Example generated PSADT script
5. Setup instructions

Ensure the system is functional end-to-end.
