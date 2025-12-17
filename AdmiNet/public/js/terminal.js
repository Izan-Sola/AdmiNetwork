const panel = document.getElementById('ssh-panel');
const cmdInput = document.getElementById('cmd-input');
const sendBtn = document.getElementById('send-cmd');

let term, ws;
let session_log = [];

panel.classList.remove('hidden');

const ip = sessionStorage.getItem('ssh_ip');
const user = sessionStorage.getItem('ssh_user');
const pass = sessionStorage.getItem('ssh_pass');

import { insertDeviceLog } from "./logManager.js";

function initTerminal() {
  term = new Terminal({
    cursorBlink: true,
    fontFamily: 'Consolas, monospace'
  });

  term.open(document.getElementById('xterm'));

  ws = new WebSocket(`ws://${location.host}/ssh`);

  ws.onopen = () => {
    console.log("WS OPEN");
    ws.send(JSON.stringify({ ip, user, pass }));
    term.writeln(`\x1b[36mConnecting to ${ip}...\x1b[0m`);
  };

  ws.onerror = e => {
    console.error("WS ERROR", e);
  };

  ws.onclose = e => {
    console.log("WS CLOSE", e);
    session_log = [];
  };

  // ws.onmessage = async e => {
  //   console.log("RECEIVED:", e.data);

  //   let text;

  //   if (e.data instanceof Blob) {
  //     text = await e.data.text();
  //   } else {
  //     text = e.data;
  //   }

  //   try {
  //     const data = JSON.parse(text);
  //     term.write(data.message ?? "");
  //     if (data.type === "error") {
  //       insertDeviceLog(ip, "ssh", data.type, data.message);
  //     } else {
  //       session_log.push(data.message);
  //     }
  //   } catch {
  //     term.write(text);
  //     session_log.push(text);
  //   }
  // };
ws.onmessage = e => {
  try {
    const data = JSON.parse(e.data);
    term.write(data.message);

    if (data.type === "error") {
      insertDeviceLog(ip, "ssh", data.type, data.message);
    } else {
      session_log.push(data.message);
    }
  } catch {
    term.write(e.data);
    session_log.push(e.data);
  }
};


  term.onData(data => {
    term.write(data);              // local echo
    ws.send(JSON.stringify({ cmd: data }));
  });
}

initTerminal();

/* OPTIONAL input box support */
sendBtn.addEventListener('click', () => {
  const value = cmdInput.value;
  if (!value || !ws) return;

  term.write(value + '\n');
  ws.send(JSON.stringify({ cmd: value + '\n' }));
  cmdInput.value = '';
});

cmdInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') sendBtn.click();
});

window.addEventListener("beforeunload", () => {
  insertDeviceLog(ip, "ssh", "info", session_log);
});
