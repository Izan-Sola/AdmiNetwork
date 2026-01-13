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

import { insertLog } from "./logManager.js";

//* Scan the target network
function networkScan(subnet = 0) {
    pausePing();

    const IP = $('#scan-network').val();
    const mask = $('#scan-mask').val();
    subnet = (subnet == 0) ? IP + '/' + mask : subnet;

    fetch('/scanNetwork', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subnet: subnet })
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
                        // NEW: The server now returns { networkData: networkObject }
                        const networkData = response.networkData;
                        if (networkData) {
                            // Cache the entire network object with its hosts
                            networkHostsCache[networkCIDR] = networkData;
                            
                            // Add hosts to ping list
                            if (networkData.hosts && Array.isArray(networkData.hosts)) {
                                networkData.hosts.forEach(host => {
                                    allHostsToPing.push({ 
                                        host_ip: host.host_ip, 
                                        network_ip: host.network_ip || networkCIDR 
                                    });
                                });
                            }
                            
                            // Display hosts and network
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
            insertLog(
                subnet,
                "network_scan",
                "error",
                `Network scan failed for: ${subnet}. ERROR: ${err}`
            );
            resumePing();
        });
}

//* Append the hosts' and networks' info
function appendHostsAndNetworks(hosts, networks) {
    $('.cards').empty();
    
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
            
            const card = $(`
                <article class="device-card" role="article" tabindex="0">
                    <div class="device-avatar ${iconIMG}"> ${(iconIMG) ? '' : host.host_ip.split('.').pop()}</div>
            
                    <div class="device-content">
                        <div class="top-row">
                            <input type="text" class="name" value="${host.host_name || "Unknown name"}" disabled>
                            <div class="ip">${host.host_ip}</div>
                        </div>
            
                        <input type="text" class="os" value="${host.host_os}" disabled>
                        <div class="ping">Last response: &nbsp;<strong>${host.last_ping}</strong></div>
            
                        <div class="bottom-row">
                            <div class="${host.isAlive ? "status up" : "status down"}">
                                ${host.isAlive ? "🟢 UP" : "🔴 DOWN"}
                            </div>
                            <div class="card-actions">
                                <button class="btn-ghost" onclick="editDeviceCardInfo(this.closest('.device-card'))">Edit</button>
                                <button class="btn-ghost details-btn">Details</button>
                                <button class="btn-ghost" onclick="removeDeviceCard(this.closest('.device-card'))"> 🗑️ </button>
                            </div>
                        </div>
                        <h4 class="ports-services">Open Ports & Services</h4>  
                        <div class="device-details">
                        </div>
                    </div>
                </article>
            `);

            card.find(".details-btn").on("click", function () {
                const cardEl = $(this).closest(".device-card");
                cardEl.toggleClass("expanded");
            });
            
            $('.cards').append(card);
            
            if (host.openPorts) {
                try {
                    openPorts = JSON.parse(host.openPorts);
                    if (Array.isArray(openPorts) && openPorts.length > 0) {
                        openPorts.forEach(port => {
                            $(card).find('.device-details').append(`
                                <div class="port"><strong>${port.protocol}/${port.port}:</strong> ${port.service}</div>
                            `);
                        });
                    }
                } catch (e) {
                    console.error('Error parsing openPorts:', e);
                }
            }
        });
    }
    
    if (networks && networks.length > 0) {
        networks.forEach(network => {
            // Check if network already exists in the list
            const existingNetwork = $(`.networks .sub:contains("${network.cidr}")`);
            if (existingNetwork.length === 0) {
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

//* Stuff to do after the page loads
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

//* Search bar function
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

//* Scan all the available network interfaces
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
                            // Cache the network data
                            if (response.networkData) {
                                networkHostsCache[network.cidr] = response.networkData;
                            }
                            
                            // Add to network list
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
            insertLog(
                'all_networks',
                "network_scan",
                "error",
                `Network scan failed for all networks. ERROR: ${err}`
            );
        });
}

//* Load every network's data from the JSON file
function loadAllNetworks() {
    fetch('/loadNetworkData', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ network: 0 })
    })
        .then(res => res.json())
        .then(data => {
            // NEW: data.networkData is now an array of network objects
            if (data.networkData && Array.isArray(data.networkData)) {
                // Clear and rebuild network list
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
                    
                    // Cache the network data
                    networkHostsCache[network.cidr] = network;
                });
                
                // Set up click handlers
                $('.network-item').off('click').on('click', function () {
                    const networkCIDR = $(this).find('.sub').text().trim();
                    selectedNetworkCIDR = networkCIDR;
                    loadNetwork(networkCIDR);
                });
            }
        })
        .catch(err => console.error('Error loading all networks:', err));
}

//* Load the target network hosts from cache or server
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

//* Enables the name and OS inputs for editing
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

//* Sends the new name and OS to the server
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

                // Update cache
                if (networkHostsCache[selectedNetworkCIDR] && 
                    networkHostsCache[selectedNetworkCIDR].hosts) {
                    const hosts = networkHostsCache[selectedNetworkCIDR].hosts;
                    const hostIndex = hosts.findIndex(h => h.host_ip === hostIP);
                    if (hostIndex !== -1) {
                        hosts[hostIndex].host_name = inputName.val();
                        hosts[hostIndex].host_os = inputOs.val();
                        console.log(`Cache updated for ${hostIP}.`);
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

//* Update the cards' status and last ping divs
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

                // Update cache
                const cidr = selectedNetworkCIDR || status[y].network_ip;
                if (networkHostsCache[cidr] && networkHostsCache[cidr].hosts) {
                    const hosts = networkHostsCache[cidr].hosts;
                    const host = hosts.find(h => h.host_ip === status[y].ip);
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

//* Pings every host from every network to check connectivity
function pingAllHosts() {
    if (allHostsToPing.length === 0) return;
    
    fetch('/pingAllHosts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allHostsToPing })
    })
        .then(res => res.json())
        .then(data => {
            if (data.connectivityStatus) {
                updateHostStatus(data.connectivityStatus);
            }
        })
        .catch(err => console.error('Error pinging hosts:', err));
}

//* Retrieve every host from every network AND CACHE THEM
function getAllNetworksHosts() {
    fetch('/getAllNetworksHosts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
    })
        .then(res => res.json())
        .then(data => {
            // NEW: data.allHostsData is { 'cidr1': [host1, ...], 'cidr2': [host1, ...] }
            if (data.allHostsData) {
                networkHostsCache = {};
                allHostsToPing = [];
                
                // Cache hosts and build ping list
                Object.entries(data.allHostsData).forEach(([cidr, hosts]) => {
                    // Store as network object for consistency
                    networkHostsCache[cidr] = {
                        cidr: cidr,
                        hosts: hosts
                    };
                    
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

//* Remove the selected host
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
                // Update cache
                if (networkHostsCache[selectedNetworkCIDR] && 
                    networkHostsCache[selectedNetworkCIDR].hosts) {
                    networkHostsCache[selectedNetworkCIDR].hosts = 
                        networkHostsCache[selectedNetworkCIDR].hosts.filter(h => h.host_ip !== hostIP);
                }
                
                // Remove from global ping list
                allHostsToPing = allHostsToPing.filter(h => h.host_ip !== hostIP);
                
                $(card).remove();
                
                // Update stats
                const remainingCards = $('.device-card').length;
                $('.stats strong')[1].innerText = remainingCards;
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

//* Remove the selected network
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
                // Remove from DOM
                $(`.network-item .sub:contains("${selectedNetworkCIDR}")`).closest('.network-item').remove();
                
                // Remove from cache
                if (networkHostsCache[selectedNetworkCIDR]) {
                    delete networkHostsCache[selectedNetworkCIDR];
                }
                
                // Remove from ping list
                allHostsToPings = allHostsToPing.filter(h => h.network_ip !== selectedNetworkCIDR);
                
                // Clear cards if this was the selected network
                $('.cards').empty();
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

// Animation for progress bar
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

function pausePing() {
    clearInterval(pingInterval);
    pingInterval = null;
}

function resumePing() {
    if (!pingInterval) {
        pingInterval = setInterval(pingAllHosts, 15000);
    }
}

// Export functions to global scope
window.scanAllNetworks = scanAllNetworks;
window.networkScan = networkScan;
window.editDeviceCardInfo = editDeviceCardInfo;
window.saveDeviceCardInfo = saveDeviceCardInfo;
window.removeDeviceCard = removeDeviceCard;
window.removeNetwork = removeNetwork;