import { insertLog } from "./logManager.js"

let username, password
let currentDir = '.'
let ip = ""

function showLogin() {
  const card = $('.device-card.selected')[0];
  if (!card) return alert('Select a device first');

  const deviceIP = $(card).find('.ip').text().trim();
  document.getElementById('sftp-modal-ip').textContent = deviceIP;
  document.getElementById('loginError').textContent = '';
  document.getElementById('loginBox').classList.add('visible');
}

async function connectSFTP() {
  const card = $('.device-card.selected')[0];
  if (!card) return alert('Select a device first');

  ip = $(card).find('.ip').text().trim();
  username = document.getElementById('username').value.trim();
  password = document.getElementById('password').value.trim();
  const rememberMe = document.getElementById('rememberMe')?.checked ?? false;

  document.getElementById('loginError').textContent = '';

  const res = await fetch('/api/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, dir: '.', ip })
  });
  const data = await res.json();

  if (!data.success) {
    document.getElementById('loginError').textContent = '❌ ' + data.error;
    insertLog(ip, "sftp", "error", data.error);
    return;
  }

  if (rememberMe) {
    await saveCredentials(ip, username, password);
  } else {
    await deleteCredentials(ip, username);
  }

  document.getElementById('loginBox').classList.remove('visible');

  sessionStorage.setItem('ssh_user', username);
  sessionStorage.setItem('ssh_pass', password);
  sessionStorage.setItem('ssh_ip', ip);
  sessionStorage.setItem('initial_files', JSON.stringify(data.files));
  sessionStorage.setItem('initial_dir', '.');
  window.location.href = 'sftpbrowser.html';
}

async function tryAutofillCredentials() {
  const card = $('.device-card.selected')[0];
  if (!card) return;

  const deviceIP = $(card).find('.ip').text().trim();
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const rememberMeBox = document.getElementById('rememberMe');

  const currentUser = usernameInput.value.trim();
  if (!currentUser) return;

  try {
    const res = await fetch('/api/credentials/get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip: deviceIP, username: currentUser })
    });
    const data = await res.json();
    if (data.success && data.password) {
      passwordInput.value = data.password;
      if (rememberMeBox) rememberMeBox.checked = true;
    }
  } catch (e) {
    // no saved creds — silently continue
  }
}

async function saveCredentials(ip, username, password) {
  try {
    await fetch('/api/credentials/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, username, password })
    });
  } catch (e) {
    console.warn('Could not save credentials:', e);
  }
}

async function deleteCredentials(ip, username) {
  try {
    await fetch('/api/credentials/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, username })
    });
  } catch (e) {
    // not critical
  }
}

async function loadDir(dir) {
  const res = await fetch('/api/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, dir, ip })
  });
  const data = await res.json();
  if (!data.success) {
    alert('Error: ' + data.error);
    insertLog(ip, "sftp", "error", `Failed to load directory ${dir} for user "${username}": ${data.error}`);
    return;
  }
  insertLog(ip, "sftp", "info", `Successfully loaded directory ${dir} for user "${username}"`);
  renderFiles(data.files, dir);
}

function renderFiles(files, dir) {
  const fileTable = document.querySelector('#fileTable tbody');
  const pathDisplay = document.querySelector('#path');
  currentDir = dir;
  pathDisplay.textContent = `Current directory: ${dir}`;
  fileTable.innerHTML = '';

  if (dir !== '.') {
    const upDir = dir.split('/').slice(0, -1).join('/') || '.';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="4" style="cursor:pointer">⬆️ Go up</td>`;
    tr.onclick = () => loadDir(upDir);
    fileTable.appendChild(tr);
  }

  files.forEach(f => {
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    const size = document.createElement('td');
    const mod = document.createElement('td');
    const act = document.createElement('td');

    name.textContent = f.name;
    size.textContent = f.type === 'd' ? '-' : f.size;
    mod.textContent = new Date(f.modifyTime).toLocaleString();

    if (f.type === 'd') {
      name.style.cursor = 'pointer';
      name.onclick = () => loadDir(`${dir}/${f.name}`);
      act.textContent = '📁';
    } else {
      const downloadButton = document.createElement('button');
      downloadButton.textContent = '⬇️';
      downloadButton.onclick = async () => {
        const res = await fetch('/api/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, filePath: `${dir}/${f.name}`, ip })
        });
        if (res.ok) {
          const blob = await res.blob();
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = f.name;
          a.click();
          insertLog(ip, "sftp", "info", `User "${username}" successfully downloaded: ${f.name}`);
        } else {
          alert('Download failed');
          insertLog(ip, "sftp", "error", `Failed to download ${f.name} for user "${username}"`);
        }
      };
      act.appendChild(downloadButton);
    }

    tr.append(name, size, mod, act);
    fileTable.appendChild(tr);
  });
}

async function uploadFile() {
  const fileInput = document.getElementById('file-input');
  const file = fileInput.files[0];
  if (!file) return alert('Please select a file.');

  const formData = new FormData();
  formData.append('username', username);
  formData.append('password', password);
  formData.append('file', file);
  formData.append('remoteDir', currentDir);
  formData.append('ip', ip);

  const res = await fetch('/api/upload', { method: 'POST', body: formData });
  if (res.ok) {
    alert('Upload complete!');
    loadDir(currentDir);
    insertLog(ip, "sftp", "info", `User "${username}" successfully uploaded: ${file.name}`);
  } else {
    alert('Upload failed');
    insertLog(ip, "sftp", "error", `Failed to upload ${file.name} by user "${username}"`);
  }
}

window.showLogin = showLogin;
window.connectSFTP = connectSFTP;
window.renderFiles = renderFiles;
window.uploadFile = uploadFile;
window.loadDir = loadDir;
window.tryAutofillCredentials = tryAutofillCredentials;
window.setSessionVars = function (u, p, i) {
  username = u;
  password = p;
  ip = i;
};