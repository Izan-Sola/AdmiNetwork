let selectedNetworkCIDR = 0;
let allHostsToPing = [];
let networkHostsCache = {};
let regExpOS = new RegExp(`(Linux|Windows|Mac|Android)`, "i");

//Consolas, 'Courier New', monospace
//*Scan the target network
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

            fetch('/loadNetworkData', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ network: networks[0].cidr })
            })
                .then(res => res.json())
                .then(hostData => {
                    networkHostsCache[networks[0].cidr] = hostData.networkData;
                    hostData.networkData.forEach(host => {
                        allHostsToPing.push({ host_ip: host.host_ip, network_ip: host.network_ip });
                    });

                    appendHostsAndNetworks(hostData.networkData, networks);
                    resumePing();
                });
        })
        .catch(err => {
            console.error(err);
            resumePing(); 
        });
}

//* Append the hosts' and networks' info
function appendHostsAndNetworks(hosts, networks) {

    $('.cards').empty();
    //  console.log(hosts, networks)
    if (hosts != 0) {

        $('.stats strong')[1].innerText = hosts.length

        hosts.forEach(host => {
            matchedOS = regExpOS.exec(host.host_os)
            console.log(host.host_os)
            if (matchedOS) {

                switch (matchedOS[1]) {
                    case 'Linux': iconIMG = "Linux"; break
                    case 'Windows': iconIMG = "Windows"; break
                    case 'Android': iconIMG = "Android"; break
                    case 'Mac': iconIMG = "Mac"; break
                }
            } else { iconIMG = null }
            const card = $(`
                <article class="device-card" role="article" tabindex="0">
                    <div class="device-avatar ${iconIMG}"> ${(iconIMG) ? '' : host.host_ip.split('.').pop()}</div>
            
                    <div class="device-content">
                        <div class="top-row">
                            <input type="text" class="name" value="${host.host_name || "Unknown name"}" disabled>
                            <div class="ip">${host.host_ip}</div>
                        </div>
            
                        <input type="text" class="os" value="${host.host_os}" disabled>
                        <div class="ping">Last ping: &nbsp;<strong>${host.last_ping}</strong></div>
            
                        <div class="bottom-row">
                            <div class="${(host.isAlive == 1) ? "status up" : "status down"}">
                                ${(host.isAlive == 1) ? "🟢 UP" : "🔴 DOWN"}
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
            if (host.openPorts !== null) {
                openPorts = JSON.parse(host.openPorts)
                if (openPorts != null) {
                    openPorts.forEach(port => {
                        $(card).find('.device-details').append(`
                            <div class="port"><strong>${port.protocol}/${port.port}:</strong> ${port.service}</div>
                        `)
                    })
                }
            }


        });
    }
    // console.log(networks[0])
    if (networks != 0) {

        networks.forEach(network => {

            const networkCard = $(`<div class="network-item" role="listitem"">
                            <div class="left">
                                <div class="dot" style="background:linear-gradient(180deg,#60a5fa,#3b82f6)"></div>
                                <div class="meta">
                                    <div class="title">${network.interface}</div>
                                    <div class="sub"> ${network.cidr}</div>
                                </div>
                            </div>
                        </div>
                        </div>
                    `);
            $('.networks').append(networkCard)
        })
    }

    $('.network-item').on('click', function () {
        network = $(this).children().children().children()[1].textContent.trim()
        selectedNetworkCIDR = network
        loadNetwork(network)
    });
    $(".cards").on("click", ".device-card", function (e) {
        if ($(e.target).closest(".card-actions").length) return;
        $(".device-card").removeClass("selected");
        $(this).addClass("selected");
    });
}

//* Stuff to do after the page loads
$(document).ready(function () {
    // $('.cards').find('div.ip').forEach(ip => { console.log(ip)})
    console.log("LOADING!")
    loadAllNetworks()
    $('.search input').on('input', function (k) {
        searchText = $(this).val()
        searchCoincidences(searchText)
    });
    getAllNetworksHosts()

    pingInterval = setInterval(pingAllHosts, 10000)

});

//* Search bar function. Searches for coincidences on the ip and the name, hiding the respective cards when there is no match.
function searchCoincidences(searchText) {
    ipDivs = $('.cards').find('div.ip')
    nameDivs = $('.cards').find('input.name')
    cardList = $('.cards').children()
    for (i = 0; i <= cardList.length - 1; i++) {
        regExp = new RegExp(`.*${searchText}.*`, "i");
        if (ipDivs[i].textContent.match(regExp) != null || nameDivs[i].value.match(regExp) != null)
            $(ipDivs[i]).closest('.device-card').removeClass('hidden');
        else $(ipDivs[i]).closest('.device-card').addClass('hidden');
    }
}

//* Scan all the available network interfaces
function scanAllNetworks() {
    pausePing(); 

    $('#cover').removeClass('hidden')
    $('#scan-in-progress').removeClass('hidden')
    $('#scan-interfaces').html('')

    fetch('/getAllNetworks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empty: "" })
    })
        .then(res => res.json())
        .then(data => {
            $('.networks').empty();

            let pending = data.networks.length;

            data.networks.forEach(network => {
                fetch('/loadNetworkData', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ network: network.cidr })
                })
                    .then(res => res.json())
                    .then(data => {
                        if (network.cidr) networkHostsCache[network.cidr] = data.networkData;

                        appendHostsAndNetworks(0, [network]);

                        pending--;
                        if (pending === 0) {
                            $('#cover').addClass('hidden');
                            $('#scan-in-progress').addClass('hidden');
                            resumePing(); 
                        }
                    });
            });
        })
        .catch(err => {
            console.error(err);
            resumePing();
        });
}

//* Load every network's data from the database 
function loadAllNetworks() {
    fetch('/loadNetworkData', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ network: 0 })
    })
        .then(res => res.json())
        .then(data => {
            console.log(data.networkData)
            appendHostsAndNetworks(0, [data.networkData][0])
        })
}

//* Load the target network hosts from the database or cache
function loadNetwork(network) {
    if (networkHostsCache[network]) {
        console.log(`Loading hosts for ${network} from cache.`);
        appendHostsAndNetworks(networkHostsCache[network], 0);
        return;
    }

    // If not in cache, retrieve from database nad cache the data
    console.log(`Loading hosts for ${network} from database (and caching)...`);
    fetch('/loadNetworkData', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ network })
    })
        .then(res => res.json())
        .then(data => {
            networkHostsCache[network] = data.networkData;
            appendHostsAndNetworks(data.networkData, 0)
        })
        .catch(err => console.error(err));
}

//* Enables the name and OS inputs for editing.
function editDeviceCardInfo(cardElement) {
    card = cardElement
    inputName = $(card).find('input.name')
    inputOs = $(card).find('input.os')
    inputEdit = $(card).find('button').first()
    inputEdit.text('Save');
    inputEdit.attr('onclick', `saveDeviceCardInfo()`)
    inputName.attr('disabled', false);
    inputName.addClass('editing');
    inputOs.addClass('editing');
    inputOs.attr('disabled', false);
    inputName.focus();
}
//* Sends the new name and OS to the server
function saveDeviceCardInfo() {

    hostIP = $(card).find('div.ip').text();

    fetch('./updateHostDetails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newName: inputName.val(), newOs: inputOs.val(), hostIP, networkCIDR: selectedNetworkCIDR })
    })
        .then(res => res.json())
        .then(data => {
            inputEdit.text('Edit');
            inputName.attr('disabled', true);
            inputOs.attr('disabled', true);
            inputEdit.attr('onclick', `editDeviceCardInfo(this.closest('.device-card'))`)
            inputName.removeClass('editing');
            inputOs.removeClass('editing');

            if (networkHostsCache[selectedNetworkCIDR]) {
                const hostList = networkHostsCache[selectedNetworkCIDR];
                const hostIndex = hostList.findIndex(h => h.host_ip === hostIP);
                if (hostIndex !== -1) {
                    hostList[hostIndex].host_name = inputName.val();
                    hostList[hostIndex].host_os = inputOs.val();
                    console.log(`Cache updated for ${hostIP}.`);
                }
            }
        })
}

//* Update the cards' status and last ping divs
function updateHostStatus(status) {
    console.log(status)
    const ipDivs = $('.cards').find('div.ip');
    const statusDivs = $('.cards').find('div.status');
    const lastPingDivs = $('.cards').find('div.ping');

    for (let i = 0; i < ipDivs.length; i++) {
        const currentIpDiv = ipDivs.eq(i);
        const currentStatusDiv = statusDivs.eq(i);
        for (let y = 0; y < status.length; y++) {
            if (status[y].ip == currentIpDiv.html()) {
                currentStatusDiv.removeClass();

                (status[y].status == 'down')
                    ? (currentStatusDiv.addClass('status down').html("🔴 DOWN"))
                    : (currentStatusDiv.addClass('status up').html("🟢 UP"))

                lastPingDivs.eq(i).text(`${status[y].date} - ${status[y].time} ms`);

                const cidr = selectedNetworkCIDR || status[y].network_ip;
                if (networkHostsCache[cidr]) {
                    const hostList = networkHostsCache[cidr];
                    const host = hostList.find(h => h.host_ip === status[y].ip);
                    if (host) {
                        host.isAlive = (status[y].status === 'up' ? 1 : 0);
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
    fetch('/pingAllHosts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allHostsToPing })
    })
        .then(res => res.json())
        .then(data => {
            updateHostStatus(data.connectivityStatus)
        })
}

//* Retrieve every host from every network AND CACHE THEM
function getAllNetworksHosts() {
    fetch('/getAllNetworksHosts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empty: "" })
    })
        .then(res => res.json())
        .then(data => {
            //  { 'cidr1': [host1, ...], 'cidr2': [host1, ...] }
            networkHostsCache = data.allHostsData;
            allHostsToPing = [];
            // Cached hosts into the global allHostsToPing array
            Object.values(networkHostsCache).forEach(hostList => {
                hostList.forEach(host => {
                    allHostsToPing.push({ host_ip: host.host_ip, network_ip: host.network_ip });
                });
            });
        })
        .catch(err => console.error("Error fetching all hosts for caching:", err));
}

//* Remove the selected host
function removeDeviceCard(card) {
    hostIP = $(card).find('div.ip')[0].textContent
    opt = confirm("Are you sure you want to remove this device card?")

    if (opt) {
        fetch('/removeHost', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hostIP, selectedNetworkCIDR })
        })
        if (networkHostsCache[selectedNetworkCIDR]) {
            networkHostsCache[selectedNetworkCIDR] = networkHostsCache[selectedNetworkCIDR].filter(h => h.host_ip !== hostIP);
        }
        // Also remove from global ping list
        allHostsToPing = allHostsToPing.filter(h => h.host_ip !== hostIP);

        $(card).remove()
    }
}
//* Remove the selected network
function removeNetwork() {
    opt = confirm("Are you sure you want to remove this network?")
    cidrDivs = $('.network-item').find('div.sub')
    if (opt) {
        for (const div of cidrDivs) {
            if (div.innerText == selectedNetworkCIDR) $(div).closest('.network-item').remove()
        }
        fetch('/removeNetwork', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ selectedNetworkCIDR })
        })
        if (networkHostsCache[selectedNetworkCIDR]) {
            delete networkHostsCache[selectedNetworkCIDR];
        }
        allHostsToPing = allHostsToPing.filter(h => h.network_ip !== selectedNetworkCIDR);
    }
}

$(document).ready(function () {
    t = '&emsp;&emsp;&emsp;'
    d = '⇒&emsp;'
    l = 4
    barArray = Array(l).fill(t);
    setInterval(() => {
        for (let i = 0; i < l; i++) {
            setTimeout(() => {
                if (barArray[i] == t) barArray[i] = d
                else if (barArray[i] == d) barArray[i] = t
                $('#progress-bar').html(barArray.join(' '))
            }, i * 180)
        }
    }, 560)
});

function pausePing() {
    clearInterval(pingInterval);
    pingInterval = null;
}

function resumePing() {
    if (!pingInterval)
        pingInterval = setInterval(pingAllHosts, 10000);
}
