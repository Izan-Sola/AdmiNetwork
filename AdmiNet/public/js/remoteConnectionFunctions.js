import { insertLog } from "./logManager.js";

async function connectSSH() {
    const card = $('.device-card.selected')[0];
    if (!card) return alert('Select a device first');
    const ip = $(card).find('.ip').text().trim();
    showSSHModal(ip);
}

function showSSHModal(ip) {
    $('#sshModal').remove();
    const card = $('.device-card.selected')[0];
    const hostOs = card ? $(card).data('host-os') : '—';
    let portsList = '—', servicesList = '—';
    try {
        const parsed = JSON.parse($(card).data('open-ports') || '[]');
        portsList = parsed.map(p => p.port).join(', ') || '—';
        servicesList = parsed.map(p => p.service).join(', ') || '—';
    } catch { }

    const modal = $(`
        <div id="sshModal" style="
            position:fixed; inset:0; background:rgba(0,0,0,0.5);
            display:flex; align-items:center; justify-content:center; z-index:9999;">
          <div style="background:#1e1e2e; padding:24px; border-radius:8px; min-width:340px;
                      display:flex; flex-direction:column; gap:12px;
                      border:1px solid #444; color:#cdd6f4; font-family:monospace;">

            <h3 style="margin:0">SSH — ${ip}</h3>

            <!-- Auth method toggle -->
            <div style="display:flex; gap:0; border:1px solid #555; border-radius:4px; overflow:hidden;">
                <button id="authTabPassword"
                    style="flex:1; padding:7px; background:#89b4fa; border:none;
                           color:#1e1e2e; cursor:pointer; font-family:monospace; font-weight:bold;">
                    Password
                </button>
                <button id="authTabKey"
                    style="flex:1; padding:7px; background:#313244; border:none;
                           color:#cdd6f4; cursor:pointer; font-family:monospace;">
                    Key Pair
                </button>
            </div>

            <input id="sshUser" type="text" placeholder="Username"
                   style="padding:8px; background:#313244; border:1px solid #555;
                          border-radius:4px; color:#cdd6f4;" />

            <!-- Password fields -->
            <div id="passwordFields" style="display:flex; flex-direction:column; gap:12px;">
                <input id="sshPass" type="password" placeholder="Password"
                       style="padding:8px; background:#313244; border:1px solid #555;
                              border-radius:4px; color:#cdd6f4;" />
            </div>

            <!-- Key pair fields -->
            <div id="keyFields" style="display:none; flex-direction:column; gap:8px;">
                <input id="sshKeyPath" type="text" placeholder="Private key path (e.g. /home/user/.ssh/id_ed25519)"
                       style="padding:8px; background:#313244; border:1px solid #555;
                              border-radius:4px; color:#cdd6f4;" />
                <input id="sshPassphrase" type="password" placeholder="Passphrase (leave empty if none)"
                       style="padding:8px; background:#313244; border:1px solid #555;
                              border-radius:4px; color:#cdd6f4;" />
            </div>

            <label style="font-size:0.85em; display:flex; align-items:center; gap:6px;">
                <input type="checkbox" id="sshRemember" /> Remember credentials
            </label>

            <span id="sshError" style="color:#f38ba8; font-size:0.85em; min-height:1em;"></span>

            <div style="display:flex; gap:8px; justify-content:flex-end;">
                <button id="sshCancelBtn"
                    style="padding:8px 16px; background:#45475a; border:none;
                           border-radius:4px; color:#cdd6f4; cursor:pointer;">Cancel</button>
                <button id="sshConnectBtn"
                    style="padding:8px 16px; background:#89b4fa; border:none;
                           border-radius:4px; color:#1e1e2e; cursor:pointer; font-weight:bold;">
                    Connect</button>
            </div>
          </div>
        </div>
    `);

    $('body').append(modal);

    // --- Tab switching ---
    let authMode = 'password';

    $('#authTabPassword').on('click', () => {
        authMode = 'password';
        $('#authTabPassword').css({ background: '#89b4fa', color: '#1e1e2e', fontWeight: 'bold' });
        $('#authTabKey').css({ background: '#313244', color: '#cdd6f4', fontWeight: 'normal' });
        $('#passwordFields').show();
        $('#keyFields').hide();
    });

    $('#authTabKey').on('click', () => {
        authMode = 'key';
        $('#authTabKey').css({ background: '#89b4fa', color: '#1e1e2e', fontWeight: 'bold' });
        $('#authTabPassword').css({ background: '#313244', color: '#cdd6f4', fontWeight: 'normal' });
        $('#keyFields').css('display', 'flex');
        $('#passwordFields').hide();
    });

    // --- Autofill on username blur ---
    $('#sshUser').on('blur', async function () {
        const username = $(this).val().trim();
        if (!username) return;
        try {
            const res = await fetch('/api/credentials/get', {
                method: 'POST',
             headers: authHeaders(),
                body: JSON.stringify({ ip, username })
            });
            const data = await res.json();
            if (data.success && data.credential) {
                const cred = data.credential;
                if (cred.type === 'key') {
                    // Switch to key tab and fill
                    $('#authTabKey').click();
                    $('#sshKeyPath').val(cred.keyPath || '');
                    $('#sshPassphrase').val(cred.passphrase || '');
                } else {
                    $('#sshPass').val(cred.password || '');
                }
                $('#sshRemember').prop('checked', true);
            }
        } catch (e) { /* keytar unavailable */ }
    });
    sessionStorage.setItem('ssh_os', hostOs);
    sessionStorage.setItem('ssh_ports', portsList);
    sessionStorage.setItem('ssh_services', servicesList);
    $('#sshCancelBtn').on('click', () => modal.remove());

    $('#sshConnectBtn').on('click', async () => {
        const user = $('#sshUser').val().trim();
        $('#sshError').text('');

        if (!user) {
            $('#sshError').text('Username is required.');
            return;
        }

        const remember = $('#sshRemember').is(':checked');

        if (authMode === 'password') {
            const pass = $('#sshPass').val().trim();
            if (!pass) { $('#sshError').text('Password is required.'); return; }

            if (remember) {
                await fetch('/api/credentials/save', {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify({ ip, username: user, credential: { type: 'password', password: pass } })
                }).catch(() => { });
            } else {
                await fetch('/api/credentials/delete', {
                    method: 'POST',
                   headers: authHeaders(),
                    body: JSON.stringify({ ip, username: user })
                }).catch(() => { });
            }

            sessionStorage.setItem('ssh_ip', ip);
            sessionStorage.setItem('ssh_user', user);
            sessionStorage.setItem('ssh_pass', pass);
            sessionStorage.removeItem('ssh_key_path');
            sessionStorage.setItem('ssh_auth', 'password');

        } else {
            const keyPath = $('#sshKeyPath').val().trim();
            const passphrase = $('#sshPassphrase').val(); // intentionally not trimmed
            if (!keyPath) { $('#sshError').text('Private key path is required.'); return; }

            // Ask server to validate the key path exists before proceeding
            try {
                const checkRes = await fetch('/api/credentials/check-key', {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify({ keyPath })
                });
                const checkData = await checkRes.json();
                if (!checkData.exists) {
                    $('#sshError').text('Key file not found on server: ' + keyPath);
                    return;
                }
            } catch (e) {
                $('#sshError').text('Could not verify key path.');
                return;
            }

            if (remember) {
                await fetch('/api/credentials/save', {
                    method: 'POST',
                   headers: authHeaders(),
                    body: JSON.stringify({ ip, username: user, credential: { type: 'key', keyPath, passphrase } })
                }).catch(() => { });
            } else {
                await fetch('/api/credentials/delete', {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify({ ip, username: user })
                }).catch(() => { });
            }

            sessionStorage.setItem('ssh_ip', ip);
            sessionStorage.setItem('ssh_user', user);
            sessionStorage.setItem('ssh_key_path', keyPath);
            sessionStorage.setItem('ssh_passphrase', passphrase);
            sessionStorage.removeItem('ssh_pass');
            sessionStorage.setItem('ssh_auth', 'key');
        }
        sessionStorage.setItem('ssh_os', hostOs);
        sessionStorage.setItem('ssh_ports', portsList);
        sessionStorage.setItem('ssh_services', servicesList);
        modal.remove();
        window.location.href = 'console.html';
    });

    modal.on('keydown', e => { if (e.key === 'Enter') $('#sshConnectBtn').click(); });
    $('#sshUser').focus();
}

function connectTelnet() { }

function showLogin() {
    const $card = $('.device-card.selected').first();
    if ($card.length === 0) return alert('Select a device first');

    const ip = $card.find('.ip').text().trim();
    sessionStorage.setItem('ssh_ip', ip);
    sessionStorage.setItem('ssh_mode', 'sftp');

    document.getElementById('sftp-modal-ip').textContent = ip;
    $('#loginBox').css('display', 'flex');
}

$(document).ready(function () {
    $('#connect-btn').on('click', () => $('#connect-menu').toggleClass('hidden'));
    $('#loginBox button').on('click', connectSFTP);
});

window.showLogin = showLogin;
window.connectSSH = connectSSH;