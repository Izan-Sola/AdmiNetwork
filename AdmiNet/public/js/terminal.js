const panel = document.getElementById('ssh-panel');
const cmdInput = document.getElementById('cmd-input');
const sendBtn = document.getElementById('send-cmd');

let term, ws;
let session_log = []

panel.classList.remove('hidden');

const ip = sessionStorage.getItem('ssh_ip');
const user = sessionStorage.getItem('ssh_user');
const pass = sessionStorage.getItem('ssh_pass');

import { insertDeviceLog } from "./logManager.js";

function initTerminal() {
  term = new Terminal({ cursorBlink: true, fontFamily: 'Consolas, monospace' });
  term.open(document.getElementById('xterm'));

  ws = new WebSocket(`ws://${location.host}/ssh`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ ip, user, pass }));
    term.writeln(`\x1b[36mConnecting to ${ip}...\x1b[0m`);
  };
  
ws.onclose = () => {
  alert("testing onclose")
  session_log = []
}
  ws.onmessage = e => {
    const data = JSON.parse(e.data)
    term.write(data.message);
    if(data.type == "error") insertDeviceLog(ip, "ssh", data.type, data.message)
    else session_log.push(data.message)
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

window.addEventListener("beforeunload", (event) => {
  event.preventDefault();
  event.returnValue = ""; 
  insertDeviceLog(ip, "ssh", "info", session_log)

});
