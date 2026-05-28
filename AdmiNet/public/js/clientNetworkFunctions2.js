let selectedNetworkCIDR = 0;
let allHostsToPing = [];
let networkHostsCache = {};
let regExpOS = new RegExp(`(Linux|Windows|Mac|Android)`, "i");
let pingInterval = null;

let matchedOS = null;
let iconIMG = null;
let openPorts = null;

let searchText = '';
let ipDivs = null;
let nameDivs = null;
let cardList = null;
let regExp = null;
let i = 0;

let card = null;
let inputName = null;
let inputOs = null;
let inputEdit = null;
let hostIP = null;
let opt = null;
let cidrDivs = null;

let t = '';
let d = '';
let l = 0;
let barArray = [];

// Currently inspected host IP (for the detail panel)
let detailHostIP = null;

import { insertLog, displayLog } from "./logManager.js";

// ── Detail panel helpers ──────────────────────────────────────────────────────

function openDetailPanel(hostIp, hostName, portsHTML, logs) {
    detailHostIP = hostIp;

    const panel = document.getElementById('detail-panel');
    const title = document.getElementById('detail-panel-title');
    const tabPorts = document.getElementById('tab-ports');
    const tabLogs = document.getElementById('tab-logs');

    title.textContent = `${hostName || hostIp}  —  ${hostIp}`;

    // Ports tab
    if (portsHTML && portsHTML.trim() !== '') {
        tabPorts.innerHTML = portsHTML;
    } else {
        tabPorts.innerHTML = '<p class="detail-empty">No open ports found for this device.</p>';
    }

    // Logs tab — filter by IP from logManager's in-memory list
    renderLogsForHost(hostIp, tabLogs);

    // Activate first tab
    document.querySelectorAll('.detail-tab').forEach(b => b.classList.remove('active'));
    document.querySelector('.detail-tab[data-tab="ports"]').classList.add('active');
    tabPorts.classList.add('active');
    tabLogs.classList.remove('active');

    // Show panel at peek height if not already open
    if (!panel.classList.contains('peek') && panel.style.height === '' || panel.style.height === '0px') {
        panel.style.height = '';
        panel.classList.add('peek');
    }
}

function renderLogsForHost(ip, container) {
    // Pull logs from the server for this IP
    fetch('/retrieveLog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empty: "" })
    })
        .then(res => res.json())
        .then(data => {
            const filtered = (data.tempLogs || []).filter(log => ip === null || log.IP === ip);
            if (filtered.length === 0) {
                container.innerHTML = '<p class="detail-empty">No logs for this device.</p>';
                return;
            }
            container.innerHTML = filtered.map(log => `
            <div class="log-row type-${log.type}">
                <span class="log-time">${log.timestamp || ''}</span>
                <span class="log-action">${log.action || ''}</span>
                <span class="log-msg">${log.message || ''}</span>
            </div>
        `).join('');
        })
        .catch(() => {
            container.innerHTML = '<p class="detail-empty">Could not load logs.</p>';
        });
}

function closeDetailPanel() {
    const panel = document.getElementById('detail-panel');
    panel.classList.remove('peek', 'dragging');
    panel.style.height = '0';
    detailHostIP = null;
}

// ── Drag-to-resize the detail panel ──────────────────────────────────────────

(function initPanelDrag() {
    let dragging = false;
    let startY = 0;
    let startH = 0;

    document.addEventListener('DOMContentLoaded', () => {
        const handle = document.getElementById('detail-handle');
        const panel = document.getElementById('detail-panel');
        const main = panel.parentElement;

        handle.addEventListener('mousedown', e => {
            // Only drag on the handle itself, not its child buttons
            if (e.target.closest('button')) return;
            dragging = true;
            startY = e.clientY;
            startH = panel.offsetHeight;
            panel.classList.add('dragging');
            e.preventDefault();
        });

        document.addEventListener('mousemove', e => {
            if (!dragging) return;
            const delta = startY - e.clientY;          // drag up = positive
            const maxH = main.offsetHeight - 60;       // leave room for topbar
            const newH = Math.min(Math.max(startH + delta, 40), maxH);
            panel.style.height = newH + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            const panel = document.getElementById('detail-panel');
            panel.classList.remove('dragging');
            // If dragged nearly closed, close it fully
            if (panel.offsetHeight < 60) closeDetailPanel();
        });
    });
})();

// ── Tab switching ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.detail-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            document.querySelectorAll('.detail-tab').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('tab-' + tab).classList.add('active');

            // Refresh logs when switching to that tab
            if (tab === 'logs') {
                renderLogsForHost(detailHostIP, document.getElementById('tab-logs'));
            }
        });
    });

    document.getElementById('detail-close').addEventListener('click', closeDetailPanel);
});

// ── Scan the target network ───────────────────────────────────────────────────

function networkScan(subnet = 0) {
    pausePing();

    const IP = $('#scan-network').val();
    const mask = $('#scan-mask').val();
    subnet = (subnet == 0) ? IP + '/' + mask : subnet;

    fetch('/scanNetwork', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subnet })
    })
        .then(res => res.json())
        .then(data => {
            const networks = data.networks;
            if (networks && networks.length > 0) {
                const networkCIDR = networks[0].cidr;

                fetch('/loadNetworkData', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ network: networkCIDR })
                })
                    .then(res => res.json())
                    .then(response => {
                        const networkData = response.networkData;
                        if (networkData) {
                            networkHostsCache[networkCIDR] = networkData;
                            if (networkData.hosts && Array.isArray(networkData.hosts)) {
                                networkData.hosts.forEach(host => {
                                    allHostsToPing.push({
                                        host_ip: host.host_ip,
                                        network_ip: host.network_ip || networkCIDR
                                    });
                                });
                            }
                            appendHostsAndNetworks(networkData.hosts || [], networks);
                        }
                        resumePing();
                    })
                    .catch(err => {
                        console.error('Error loading network data:', err);
                        resumePing();
                    });
            } else {
                console.log('No networks found');
                resumePing();
            }
        })
        .catch(err => {
            console.error('Network scan error:', err);
            insertLog(subnet, "network_scan", "error", `Network scan failed for: ${subnet}. ERROR: ${err}`);
            resumePing();
        });
}

// ── Append hosts and networks to the DOM ─────────────────────────────────────

function appendHostsAndNetworks(hosts, networks) {
    $('.cards').empty();
    closeDetailPanel();

    if (hosts && hosts.length > 0) {
        $('.stats strong')[1].innerText = hosts.length;

        hosts.forEach(host => {
            matchedOS = regExpOS.exec(host.host_os);
            if (matchedOS) {
                switch (matchedOS[1]) {
                    case 'Linux': iconIMG = "Linux"; break;
                    case 'Windows': iconIMG = "Windows"; break;
                    case 'Android': iconIMG = "Android"; break;
                    case 'Mac': iconIMG = "Mac"; break;
                }
            } else {
                iconIMG = null;
            }

            // Build ports HTML string to pass into the panel later
            let portsHTML = '';
            if (host.openPorts) {
                try {
                    const parsed = JSON.parse(host.openPorts);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        portsHTML = parsed.map(p =>
                            `<div class="port"><strong>${p.protocol}/${p.port}:</strong> ${p.service}</div>`
                        ).join('');
                    }
                } catch (e) {
                    console.error('Error parsing openPorts:', e);
                }
            }

            const cardEl = $(`
                <article class="device-card" role="article" tabindex="0">
                    <div class="device-avatar ${iconIMG || ''}">
                        ${iconIMG ? '' : host.host_ip.split('.').pop()}
                    </div>
                    <div class="device-content">
                        <div class="top-row">
                            <input type="text" class="name" value="${host.host_name || 'Unknown name'}" disabled>
                            <div class="ip">${host.host_ip}</div>
                        </div>
                        <input type="text" class="os" value="${host.host_os}" disabled>
                        <div class="ping">Last response: &nbsp;<strong>${host.last_ping}</strong></div>
                        <div class="bottom-row">
                            <div class="${host.isAlive ? 'status up' : 'status down'}">
                                ${host.isAlive ? '🟢 UP' : '🔴 DOWN'}
                            </div>
                            <div class="card-actions">
                                <button class="btn-ghost" onclick="editDeviceCardInfo(this.closest('.device-card'))">Edit</button>
                                <button class="btn-ghost details-btn">Details</button>
                                <button class="btn-ghost" onclick="removeDeviceCard(this.closest('.device-card'))">🗑️</button>
                            </div>
                        </div>
                    </div>
                </article>
            `);

            // Details button opens the panel instead of expanding the card
            cardEl.find('.details-btn').on('click', function (e) {
                e.stopPropagation();
                openDetailPanel(host.host_ip, host.host_name, portsHTML, []);
            });

            $('.cards').append(cardEl);
        });
    }

    if (networks && networks.length > 0) {
        networks.forEach(network => {
            const existing = $(`.networks .sub:contains("${network.cidr}")`);
            if (existing.length === 0) {
                const networkCard = $(`
                    <div class="network-item" role="listitem">
                        <div class="left">
                            <div class="dot" style="background:linear-gradient(180deg,#60a5fa,#3b82f6)"></div>
                            <div class="meta">
                                <div class="title">${network.interface || 'Unknown Interface'}</div>
                                <div class="sub">${network.cidr}</div>
                            </div>
                        </div>
                    </div>
                `);
                $('.networks').append(networkCard);
            }
        });
    }

    $('.network-item').off('click').on('click', function () {
        const networkCIDR = $(this).find('.sub').text().trim();
        selectedNetworkCIDR = networkCIDR;
        loadNetwork(networkCIDR);
    });

    $(".cards").off("click").on("click", ".device-card", function (e) {
        if ($(e.target).closest(".card-actions").length) return;
        $(".device-card").removeClass("selected");
        $(this).addClass("selected");
    });
}

// ── Page load ────────────────────────────────────────────────────────────────

$(document).ready(function () {
    console.log("LOADING!");
    loadAllNetworks();

    $('.search input').on('input', function () {
        searchText = $(this).val();
        searchCoincidences(searchText);
    });

    getAllNetworksHosts();
    pingInterval = setInterval(pingAllHosts, 10000);
});

// ── Search ────────────────────────────────────────────────────────────────────

function searchCoincidences(searchText) {
    ipDivs = $('.cards').find('div.ip');
    nameDivs = $('.cards').find('input.name');
    cardList = $('.cards').children();

    for (let i = 0; i < cardList.length; i++) {
        regExp = new RegExp(`.*${searchText}.*`, "i");
        const ip = ipDivs.eq(i).text();
        const name = nameDivs.eq(i).val();

        if (regExp.test(ip) || regExp.test(name)) {
            cardList.eq(i).removeClass('hidden');
        } else {
            cardList.eq(i).addClass('hidden');
        }
    }
}

// ── Scan all networks ─────────────────────────────────────────────────────────

function scanAllNetworks() {
    pausePing();

    $('#cover').removeClass('hidden');
    $('#scan-in-progress').removeClass('hidden');
    $('#scan-interfaces').html('');

    fetch('/getAllNetworks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
    })
        .then(res => res.json())
        .then(data => {
            $('.networks').empty();

            if (data.networks && data.networks.length > 0) {
                let pending = data.networks.length;

                data.networks.forEach(network => {
                    fetch('/loadNetworkData', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ network: network.cidr })
                    })
                        .then(res => res.json())
                        .then(response => {
                            if (response.networkData) {
                                networkHostsCache[network.cidr] = response.networkData;
                            }

                            const networkCard = $(`
                                <div class="network-item" role="listitem">
                                    <div class="left">
                                        <div class="dot" style="background:linear-gradient(180deg,#60a5fa,#3b82f6)"></div>
                                        <div class="meta">
                                            <div class="title">${network.interface || 'Unknown Interface'}</div>
                                            <div class="sub">${network.cidr}</div>
                                        </div>
                                    </div>
                                </div>
                            `);
                            $('.networks').append(networkCard);

                            pending--;
                            if (pending === 0) {
                                $('#cover').addClass('hidden');
                                $('#scan-in-progress').addClass('hidden');
                                resumePing();
                            }
                        })
                        .catch(err => {
                            console.error(`Error loading network ${network.cidr}:`, err);
                            pending--;
                            if (pending === 0) {
                                $('#cover').addClass('hidden');
                                $('#scan-in-progress').addClass('hidden');
                                resumePing();
                            }
                        });
                });
            } else {
                $('#cover').addClass('hidden');
                $('#scan-in-progress').addClass('hidden');
                resumePing();
            }
        })
        .catch(err => {
            console.error('Error scanning all networks:', err);
            $('#cover').addClass('hidden');
            $('#scan-in-progress').addClass('hidden');
            resumePing();
            insertLog('all_networks', "network_scan", "error", `Network scan failed for all networks. ERROR: ${err}`);
        });
}

// ── Load all networks from JSON ───────────────────────────────────────────────

function loadAllNetworks() {
    fetch('/loadNetworkData', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ network: 0 })
    })
        .then(res => res.json())
        .then(data => {
            if (data.networkData && Array.isArray(data.networkData)) {
                $('.networks').empty();

                data.networkData.forEach(network => {
                    const networkCard = $(`
                        <div class="network-item" role="listitem">
                            <div class="left">
                                <div class="dot" style="background:linear-gradient(180deg,#60a5fa,#3b82f6)"></div>
                                <div class="meta">
                                    <div class="title">${network.interface || 'Unknown Interface'}</div>
                                    <div class="sub">${network.cidr}</div>
                                </div>
                            </div>
                        </div>
                    `);
                    $('.networks').append(networkCard);
                    networkHostsCache[network.cidr] = network;
                });

                $('.network-item').off('click').on('click', function () {
                    const networkCIDR = $(this).find('.sub').text().trim();
                    selectedNetworkCIDR = networkCIDR;
                    loadNetwork(networkCIDR);
                });
            }
        })
        .catch(err => console.error('Error loading all networks:', err));
}

// ── Load a specific network ───────────────────────────────────────────────────

function loadNetwork(networkCIDR) {
    if (networkHostsCache[networkCIDR]) {
        console.log(`Loading hosts for ${networkCIDR} from cache.`);
        const networkData = networkHostsCache[networkCIDR];
        appendHostsAndNetworks(networkData.hosts || [], []);
        return;
    }

    console.log(`Loading hosts for ${networkCIDR} from server...`);
    fetch('/loadNetworkData', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ network: networkCIDR })
    })
        .then(res => res.json())
        .then(data => {
            if (data.networkData) {
                networkHostsCache[networkCIDR] = data.networkData;
                appendHostsAndNetworks(data.networkData.hosts || [], []);
            }
        })
        .catch(err => console.error('Error loading network:', err));
}

// ── Edit / save card info ─────────────────────────────────────────────────────

function editDeviceCardInfo(cardElement) {
    card = cardElement;
    inputName = $(card).find('input.name');
    inputOs = $(card).find('input.os');
    inputEdit = $(card).find('button').first();
    inputEdit.text('Save');
    inputEdit.attr('onclick', `saveDeviceCardInfo()`);
    inputName.attr('disabled', false);
    inputName.addClass('editing');
    inputOs.addClass('editing');
    inputOs.attr('disabled', false);
    inputName.focus();
}

function saveDeviceCardInfo() {
    hostIP = $(card).find('div.ip').text();

    fetch('/updateHostDetails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            newName: inputName.val(),
            newOs: inputOs.val(),
            hostIP,
            networkCIDR: selectedNetworkCIDR
        })
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                inputEdit.text('Edit');
                inputName.attr('disabled', true);
                inputOs.attr('disabled', true);
                inputEdit.attr('onclick', `editDeviceCardInfo(this.closest('.device-card'))`);
                inputName.removeClass('editing');
                inputOs.removeClass('editing');

                if (networkHostsCache[selectedNetworkCIDR] && networkHostsCache[selectedNetworkCIDR].hosts) {
                    const hosts = networkHostsCache[selectedNetworkCIDR].hosts;
                    const hostIndex = hosts.findIndex(h => h.host_ip === hostIP);
                    if (hostIndex !== -1) {
                        hosts[hostIndex].host_name = inputName.val();
                        hosts[hostIndex].host_os = inputOs.val();
                    }
                }
            } else {
                alert('Failed to update host: ' + (data.message || 'Unknown error'));
            }
        })
        .catch(err => {
            console.error('Error updating host:', err);
            alert('Error updating host. Please try again.');
        });
}

// ── Ping / status update ──────────────────────────────────────────────────────

function updateHostStatus(status) {
    const ipDivs = $('.cards').find('div.ip');
    const statusDivs = $('.cards').find('div.status');
    const lastPingDivs = $('.cards').find('div.ping');

    for (let i = 0; i < ipDivs.length; i++) {
        const currentIpDiv = ipDivs.eq(i);
        const currentStatusDiv = statusDivs.eq(i);
        const currentLastPingDiv = lastPingDivs.eq(i);

        for (let y = 0; y < status.length; y++) {
            if (status[y].ip == currentIpDiv.text()) {
                currentStatusDiv.removeClass();

                if (status[y].status == 'down') {
                    currentStatusDiv.addClass('status down').html("🔴 DOWN");
                } else {
                    currentStatusDiv.addClass('status up').html("🟢 UP");
                    currentLastPingDiv.html(`Last response: <strong>${status[y].date} - ${status[y].time} ms</strong>`);
                }

                const cidr = selectedNetworkCIDR || status[y].network_ip;
                if (networkHostsCache[cidr] && networkHostsCache[cidr].hosts) {
                    const host = networkHostsCache[cidr].hosts.find(h => h.host_ip === status[y].ip);
                    if (host) {
                        host.isAlive = status[y].status === 'up';
                        host.last_ping = `${status[y].date} - ${status[y].time} ms`;
                    }
                }
                break;
            }
        }
    }
}

function pingAllHosts() {
    if (allHostsToPing.length === 0) return;

    fetch('/pingAllHosts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allHostsToPing })
    })
        .then(res => res.json())
        .then(data => {
            if (data.connectivityStatus) updateHostStatus(data.connectivityStatus);
        })
        .catch(err => console.error('Error pinging hosts:', err));
}

function getAllNetworksHosts() {
    fetch('/getAllNetworksHosts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
    })
        .then(res => res.json())
        .then(data => {
            if (data.allHostsData) {
                networkHostsCache = {};
                allHostsToPing = [];

                Object.entries(data.allHostsData).forEach(([cidr, hosts]) => {
                    networkHostsCache[cidr] = { cidr, hosts };
                    hosts.forEach(host => {
                        allHostsToPing.push({
                            host_ip: host.host_ip,
                            network_ip: host.network_ip || cidr
                        });
                    });
                });

                console.log(`Cached ${Object.keys(networkHostsCache).length} networks with ${allHostsToPing.length} total hosts`);
            }
        })
        .catch(err => console.error("Error fetching all hosts for caching:", err));
}

// ── Remove host / network ─────────────────────────────────────────────────────

function removeDeviceCard(card) {
    hostIP = $(card).find('div.ip').text();
    opt = confirm("Are you sure you want to remove this device card?");

    if (opt) {
        fetch('/removeHost', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hostIP, selectedNetworkCIDR })
        })
            .then(res => {
                if (res.ok) {
                    if (networkHostsCache[selectedNetworkCIDR] && networkHostsCache[selectedNetworkCIDR].hosts) {
                        networkHostsCache[selectedNetworkCIDR].hosts =
                            networkHostsCache[selectedNetworkCIDR].hosts.filter(h => h.host_ip !== hostIP);
                    }
                    allHostsToPing = allHostsToPing.filter(h => h.host_ip !== hostIP);
                    $(card).remove();
                    $('.stats strong')[1].innerText = $('.device-card').length;

                    // Close panel if it was showing this host
                    if (detailHostIP === hostIP) closeDetailPanel();
                } else {
                    alert('Failed to remove host');
                }
            })
            .catch(err => {
                console.error('Error removing host:', err);
                alert('Error removing host. Please try again.');
            });
    }
}

function removeNetwork() {
    opt = confirm("Are you sure you want to remove this network?");

    if (opt) {
        fetch('/removeNetwork', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ selectedNetworkCIDR })
        })
            .then(res => {
                if (res.ok) {
                    $(`.network-item .sub:contains("${selectedNetworkCIDR}")`).closest('.network-item').remove();
                    if (networkHostsCache[selectedNetworkCIDR]) delete networkHostsCache[selectedNetworkCIDR];
                    allHostsToPing = allHostsToPing.filter(h => h.network_ip !== selectedNetworkCIDR);
                    $('.cards').empty();
                    closeDetailPanel();
                    selectedNetworkCIDR = 0;
                } else {
                    alert('Failed to remove network');
                }
            })
            .catch(err => {
                console.error('Error removing network:', err);
                alert('Error removing network. Please try again.');
            });
    }
}

// ── Progress bar animation ────────────────────────────────────────────────────

$(document).ready(function () {
    t = '&emsp;&emsp;&emsp;';
    d = '⇒&emsp;';
    l = 4;
    barArray = Array(l).fill(t);

    setInterval(() => {
        for (let i = 0; i < l; i++) {
            setTimeout(() => {
                barArray[i] = barArray[i] === t ? d : t;
                $('#progress-bar').html(barArray.join(' '));
            }, i * 180);
        }
    }, 560);
});

// ── Ping interval helpers ─────────────────────────────────────────────────────

function pausePing() {
    clearInterval(pingInterval);
    pingInterval = null;
}

function resumePing() {
    if (!pingInterval) {
        pingInterval = setInterval(pingAllHosts, 5000);
    }
}

// ── Global exports ────────────────────────────────────────────────────────────

window.scanAllNetworks = scanAllNetworks;
window.networkScan = networkScan;
window.editDeviceCardInfo = editDeviceCardInfo;
window.saveDeviceCardInfo = saveDeviceCardInfo;
window.removeDeviceCard = removeDeviceCard;
window.removeNetwork = removeNetwork;
window.openDetailPanel = openDetailPanel;
window.closeDetailPanel = closeDetailPanel;