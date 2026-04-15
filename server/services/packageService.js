const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const paths = require('../paths');

const pkgBase = paths.packagesDir;

// Convert a comma-separated string like "excel,winword" into a PS array literal @('excel', 'winword')
Handlebars.registerHelper('psArray', function (value) {
  if (!value) return '@()';
  const items = String(value).split(',').map((s) => `'${s.trim()}'`).join(', ');
  return `@(${items})`;
});

function readTemplate(psadtVersion, name) {
  const ver = psadtVersion === 'v4' ? 'v4' : 'v3';
  return fs.readFileSync(path.join(paths.templatesDir, ver, name), 'utf-8');
}

function getTemplateSet(psadtVersion) {
  if (psadtVersion === 'v4') {
    return {
      script: { file: 'Invoke-AppDeployToolkit.ps1', template: 'Invoke-AppDeployToolkit.ps1.hbs' },
      config: { file: 'Config.psd1', template: 'Config.psd1.hbs' },
    };
  }
  return {
    script: { file: 'Deploy-Application.ps1', template: 'Deploy-Application.ps1.hbs' },
    config: { file: 'AppDeployToolkitConfig.xml', template: 'AppDeployToolkitConfig.xml.hbs' },
  };
}

function generateScripts(dir, data) {
  const ver = data.psadtVersion || 'v3';
  const tpl = getTemplateSet(ver);
  const scriptTpl = Handlebars.compile(readTemplate(ver, tpl.script.template));
  const configTpl = Handlebars.compile(readTemplate(ver, tpl.config.template));

  fs.writeFileSync(path.join(dir, tpl.script.file), scriptTpl(data));
  fs.writeFileSync(path.join(dir, tpl.config.file), configTpl(data));
}

exports.listAll = async () => {
  if (!fs.existsSync(pkgBase)) return [];
  const apps = fs.readdirSync(pkgBase, { withFileTypes: true }).filter((d) => d.isDirectory());
  const result = [];
  for (const app of apps) {
    const appDir = path.join(pkgBase, app.name);
    const versions = fs.readdirSync(appDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const ver of versions) {
      const metaPath = path.join(appDir, ver.name, 'metadata.json');
      if (fs.existsSync(metaPath)) {
        result.push(JSON.parse(fs.readFileSync(metaPath, 'utf-8')));
      } else {
        result.push({ appName: app.name, version: ver.name });
      }
    }
  }
  return result;
};

exports.getApp = async (appName) => {
  const appDir = path.join(pkgBase, appName);
  if (!fs.existsSync(appDir)) throw new Error('App not found');
  const versions = fs.readdirSync(appDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  return { appName, versions: versions.map((v) => v.name) };
};

// Regenerate scripts for a package from its saved metadata and the current templates
exports.regenerate = async (appName, version) => {
  const dir = path.join(pkgBase, appName, version);
  const metaPath = path.join(dir, 'metadata.json');
  if (!fs.existsSync(metaPath)) throw new Error('Package not found');
  const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  generateScripts(dir, metadata);
  return metadata;
};

exports.getVersion = async (appName, version) => {
  const metaPath = path.join(pkgBase, appName, version, 'metadata.json');
  if (!fs.existsSync(metaPath)) throw new Error('Package not found');
  return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
};

exports.create = async (data) => {
  const { appName, version } = data;
  if (!appName || !version) throw new Error('appName and version are required');
  const dir = path.join(pkgBase, appName, version);
  fs.mkdirSync(path.join(dir, 'Files'), { recursive: true });

  const metadata = { ...data, createdAt: new Date().toISOString(), status: 'draft' };
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(metadata, null, 2));

  generateScripts(dir, metadata);
  return metadata;
};

exports.update = async (appName, version, data) => {
  const dir = path.join(pkgBase, appName, version);
  const metaPath = path.join(dir, 'metadata.json');
  if (!fs.existsSync(metaPath)) throw new Error('Package not found');

  const existing = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  const metadata = { ...existing, ...data, updatedAt: new Date().toISOString() };
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

  generateScripts(dir, metadata);
  return metadata;
};

exports.getEntryScript = (appName, version) => {
  const dir = path.join(pkgBase, appName, version);
  const metaPath = path.join(dir, 'metadata.json');
  if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    if (meta.psadtVersion === 'v4') {
      return path.join(dir, 'Invoke-AppDeployToolkit.ps1');
    }
  }
  return path.join(dir, 'Deploy-Application.ps1');
};

exports.remove = async (appName, version) => {
  const dir = path.join(pkgBase, appName, version);
  if (!fs.existsSync(dir)) throw new Error('Package not found');
  fs.rmSync(dir, { recursive: true, force: true });
  const appDir = path.join(pkgBase, appName);
  if (fs.existsSync(appDir) && fs.readdirSync(appDir).length === 0) {
    fs.rmdirSync(appDir);
  }
};

exports.listFiles = async (appName, version) => {
  const filesDir = path.join(pkgBase, appName, version, 'Files');
  if (!fs.existsSync(filesDir)) return [];
  return fs.readdirSync(filesDir);
};

exports.deleteFile = async (appName, version, filename) => {
  const filePath = path.join(pkgBase, appName, version, 'Files', filename);
  if (!fs.existsSync(filePath)) throw new Error('File not found');
  fs.unlinkSync(filePath);
};
