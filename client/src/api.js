const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

// Packages
export const listPackages = () => request('/packages');
export const getPackage = (appName, version) => request(`/packages/${appName}/${version}`);
export const createPackage = (data) => request('/packages', { method: 'POST', body: JSON.stringify(data) });
export const updatePackage = (appName, version, data) =>
  request(`/packages/${appName}/${version}`, { method: 'PUT', body: JSON.stringify(data) });
export const deletePackage = (appName, version) =>
  request(`/packages/${appName}/${version}`, { method: 'DELETE' });
export const importPackage = (sourcePath) =>
  request('/packages/import', { method: 'POST', body: JSON.stringify({ sourcePath }) });
export const regeneratePackage = (appName, version) =>
  request(`/packages/${appName}/${version}/regenerate`, { method: 'POST' });
export const listFiles = (appName, version) => request(`/packages/${appName}/${version}/files`);
export const deleteFile = (appName, version, filename) =>
  request(`/packages/${appName}/${version}/files/${filename}`, { method: 'DELETE' });

export async function uploadFiles(appName, version, files) {
  const form = new FormData();
  for (const f of files) form.append('files', f);
  const res = await fetch(`${BASE}/packages/${appName}/${version}/upload`, { method: 'POST', body: form });
  if (!res.ok) throw new Error('Upload failed');
  return res.json();
}

// Execution
export const runPackage = (appName, version, mode, deploymentType, target, username, password) =>
  request('/execution/run', { method: 'POST', body: JSON.stringify({ appName, version, mode, deploymentType, target, username, password }) });
export const runWrapper = (steps) =>
  request('/execution/run-wrapper', { method: 'POST', body: JSON.stringify({ steps }) });
export const getExecStatus = (id) => request(`/execution/status/${id}`);
export const listLogs = () => request('/execution/logs');
export const getLog = (id) => request(`/execution/logs/${id}`);

export const checkMissingFiles = (appName, version) => request(`/packages/${appName}/${version}/check-files`);

// Git
export const gitClone = (url) => request('/git/clone', { method: 'POST', body: JSON.stringify({ url }) });
export const gitPull = () => request('/git/pull', { method: 'POST' });
export const gitPush = () => request('/git/push', { method: 'POST' });
export const gitStatus = () => request('/git/status');
export const gitPublish = (appName, version) => request('/git/publish', { method: 'POST', body: JSON.stringify({ appName, version }) });
export const gitLog = () => request('/git/log');

// Config
export const getConfig = () => request('/config');
export const updateConfig = (data) => request('/config', { method: 'PUT', body: JSON.stringify(data) });

// MSI Builder
export const detectMsiTools = () => request('/msi/detect-tools');

export async function probeMsi(file) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/msi/probe`, { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export async function buildMsi(formData) {
  const res = await fetch(`${BASE}/msi/build`, { method: 'POST', body: formData });
  return res;
}

// Intune .intunewin packager
export const getIntuneToolStatus = () => request('/intune/status');
export const downloadIntuneTool = () => request('/intune/download', { method: 'POST' });
export const buildIntuneWin = (data) =>
  request('/intune/build', { method: 'POST', body: JSON.stringify(data) });

// Group management — credential = { adUsername, adPassword } | null | undefined
const creds = (c) => (c ? { adUsername: c.adUsername, adPassword: c.adPassword } : {});
export const verifyGroup = (name, type, credential) =>
  request('/groups/verify-group', { method: 'POST', body: JSON.stringify({ name, type, ...creds(credential) }) });
export const getGroupMembers = (name, type, credential) =>
  request('/groups/members', { method: 'POST', body: JSON.stringify({ name, type, ...creds(credential) }) });
export const verifyUser = (username, type, credential) =>
  request('/groups/verify-user', { method: 'POST', body: JSON.stringify({ username, type, ...creds(credential) }) });
export const addUserToGroup = (username, groupName, type, credential) =>
  request('/groups/add-user', { method: 'POST', body: JSON.stringify({ username, groupName, type, ...creds(credential) }) });
export const removeUserFromGroup = (username, groupName, type, credential) =>
  request('/groups/remove-user', { method: 'POST', body: JSON.stringify({ username, groupName, type, ...creds(credential) }) });
