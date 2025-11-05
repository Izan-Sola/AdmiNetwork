const demoConnect = document.getElementById('demo-connect');
const panel = document.getElementById('ssh-panel');
const cmdInput = document.getElementById('cmd-input');
const sendBtn = document.getElementById('send-cmd');

let term;

demoConnect.addEventListener('click', () => {
  panel.classList.remove('hidden');
  if (!term) initTerminal();
});

function initTerminal() {
  term = new Terminal({
    cursorBlink: true,
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 13,
    theme: {
      background: '#04121a',
      foreground: '#d8f3ff',
      cursor: '#38bdf8',
      black: '#000000',
      brightBlack: '#555555',
      red: '#ff5555',
      brightRed: '#ff6e67',
      green: '#50fa7b',
      brightGreen: '#5af78e',
      yellow: '#f1fa8c',
      brightYellow: '#f4f99d',
      blue: '#bd93f9',
      brightBlue: '#caa9fa',
      magenta: '#ff79c6',
      brightMagenta: '#ff92d0',
      cyan: '#8be9fd',
      brightCyan: '#9aedfe',
      white: '#bbbbbb',
      brightWhite: '#ffffff'
    }
  });
  term.open(document.getElementById('xterm'));
  term.writeln('\x1b[36mConnecting to host...\x1b[0m');
  setTimeout(() => {
    term.writeln('Connected to \x1b[1m192.168.1.10\x1b[0m');
    term.write('$ ');
  }, 800);
}

sendBtn.addEventListener('click', () => {
  const value = cmdInput.value.trim();
  if (!value || !term) return;
  term.writeln(`${value}`);
  term.writeln(`output: simulated response for "${value}"`);
  term.write('$ ');
  cmdInput.value = '';
});

cmdInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') sendBtn.click();
});
