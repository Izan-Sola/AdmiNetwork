import { insertLog } from "./logManager";

function connectSSH() {
    const card = $('.device-card.selected')[0];
    if (!card) return alert('Select a device first');

    const ip = $(card).find('.ip').text().trim();
    const user = prompt('Enter username:');
    const pass = prompt('Enter password:');
    
    if (!user || !pass) return;

    sessionStorage.setItem('ssh_ip', ip);
    sessionStorage.setItem('ssh_user', user);
    sessionStorage.setItem('ssh_pass', pass);

    window.location.href = 'console.html';

    insertLog(
        ip,
        "ssh",
        "info",
        `User "${user}" has remotely connected to this device via SSH`,
    )
}

function connectTelnet() {}
function showLogin() {
    const $card = $('.device-card.selected').first();
    if ($card.length === 0) return alert('Select a device first');

    const ip = $card.find('.ip').text().trim();
    sessionStorage.setItem('ssh_ip', ip);
    sessionStorage.setItem('ssh_mode', 'sftp');

    $('#loginBox').show();
}


$(document).ready(function () {
    $('#connect-btn').on('click', () => {
        $('#connect-menu').toggleClass('hidden');
    });
    $('#loginBox button').on('click', connectSFTP);
});