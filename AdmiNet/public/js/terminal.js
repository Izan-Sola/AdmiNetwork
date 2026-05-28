import { insertLog } from "./logManager.js";

const panel = document.getElementById('ssh-panel');
panel.classList.remove('hidden');

const ip = sessionStorage.getItem('ssh_ip');
const user = sessionStorage.getItem('ssh_user');
const authType = sessionStorage.getItem('ssh_auth') || 'password';
const pass = sessionStorage.getItem('ssh_pass');
const keyPath = sessionStorage.getItem('ssh_key_path');
const passphrase = sessionStorage.getItem('ssh_passphrase') || '';

let term, ws;
let session_log = [];
let currentCmd = '';

function stripEscapes(str) {
  return str
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b[^[\]]/g, '')
    .replace(/\[?\?2004[hl]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function initTerminal() {
  term = new Terminal({
    cursorBlink: true,
    fontFamily: 'Consolas, monospace'
  });

  term.open(document.getElementById('xterm'));

  ws = new WebSocket(`wss://${location.host}/ssh`);

  ws.onopen = () => {
    console.log("WS OPEN");
    const initMsg = { ip, user };
    if (authType === 'key') {
      initMsg.keyPath = keyPath;
      initMsg.passphrase = passphrase;
    } else {
      initMsg.pass = pass;
    }
    ws.send(JSON.stringify(initMsg));
    term.writeln(`\x1b[36mConnecting to ${ip}...\x1b[0m`);
  };

  ws.onerror = e => console.error("WS ERROR", e);
  ws.onclose = e => console.log("WS CLOSE", e);

  ws.onmessage = e => {
    try {
      const data = JSON.parse(e.data);
      term.write(data.message);
      if (data.type === "error") {
        insertLog(ip, "ssh", "error", stripEscapes(data.message));
      }
      // no session_log push here
    } catch {
      term.write(e.data);
      // no session_log push here
    }
  };

  term.onData(data => {
    ws.send(JSON.stringify({ cmd: data }));

    if (data === '\r') {
      const trimmed = currentCmd.trim();
      if (trimmed) session_log.push(trimmed);
      currentCmd = '';
    } else if (data === '\x7f') {
      currentCmd = currentCmd.slice(0, -1);
    } else if (data.length === 1 && data >= ' ') {
      currentCmd += data;
    }
  });
}

initTerminal();

window.addEventListener("beforeunload", () => {
  const summary = session_log.length > 0
    ? `Commands run:\n  • ${session_log.join('\n  • ')}`
    : 'No commands recorded.';
  insertLog(ip, "ssh", "info", `SSH session ended for "${user}"\n${summary}`);
  session_log = [];
});