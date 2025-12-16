const panel = document.getElementById('ssh-panel');
const cmdInput = document.getElementById('cmd-input');
const sendBtn = document.getElementById('send-cmd');

let term, ws;

panel.classList.remove('hidden');

const ip = sessionStorage.getItem('ssh_ip');
const user = sessionStorage.getItem('ssh_user');
const pass = sessionStorage.getItem('ssh_pass');

import { insertLog } from "./logManager.js";

function initTerminal() {
  term = new Terminal({ cursorBlink: true, fontFamily: 'Consolas, monospace' });
  term.open(document.getElementById('xterm'));

  ws = new WebSocket(`ws://${location.host}/ssh`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ ip, user, pass }));
    term.writeln(`\x1b[36mConnecting to ${ip}...\x1b[0m`);
  };

  ws.onmessage = e => {
    const data = JSON.parse(e.data)
    term.write(data.message);

    console.log(data)

    insertLog(ip, "ssh", data.type, data.message)
  };

  term.onData(data => {
    ws.send(JSON.stringify({ cmd: data }));
  });
}

initTerminal();

sendBtn.addEventListener('click', () => {
  const value = cmdInput.value.trim();
  if (!value || !term) return;
  ws.send(JSON.stringify({ message: value + '\n', type: "info" }));
  cmdInput.value = '';
});

cmdInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') sendBtn.click();
});
