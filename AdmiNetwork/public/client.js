let selectedNetworkCIDR = 0;
//*Scan the target network
function networkScan(subnet = 0) {
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
        console.log(data.networks[0])
        networks = data.networks
        fetch('/loadNetworkData', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ network: networks[0].cidr })
        })
        .then(res => res.json())
        .then(data => {
            appendHostsAndNetworks(data.networkData, networks)
        })
        
    })
    .catch(err => console.error(err));
}

//* Append the hosts' and networks' info
function appendHostsAndNetworks(hosts, networks) {
   
   
   //$('.networks').empty();
   availableNetworks = []
      console.log($('.networks').children().length)
    if($('.networks').children().length > 0) {
            [$('.networks').children()].forEach( item => {
                cidr = item.children().children().children()[1].textContent.trim()
                availableNetworks.push(cidr)
            })
        }
        console.log(availableNetworks)
    $('.cards').empty();
    console.log(hosts, networks)
    if(hosts != 0) {
        hosts.forEach(host => {
       
            console.log(host.host_ip)
            const card = $(`
                <article class="device-card" role="article" tabindex="0">
                    <div class="device-avatar">${host.host_ip.split('.').pop()}</div>
    
                    <div class="device-content">
                        <div class="top-row">
                            <input type="text" class="name" value="${host.host_name || "Unknown name"}" disabled>
                            <div class="ip">${host.host_ip}</div>
                        </div>
    
                        <input type="text" class="os" value="${host.host_os}" disabled>
                        <div class="ping">Last ping: &nbsp;<strong>  ${host.last_ping}</strong></div>
    
                        <div class="bottom-row">
                            <div class="status up">🟢 UP</div>
                            <div class="card-actions">
                                <button class="btn-ghost" onclick="editDeviceCardInfo(this.closest('.device-card'))">Edit</button>
                                <button class="btn">Connect</button>
                            </div>
                        </div>
                    </div>
                </article>
            `);
            $('.cards').append(card);
        });
    }
   
    if(networks != 0) {
        networks.forEach(network => {

            if(!availableNetworks.includes(network.cidr)) {
                $('.cards').empty();
                        const networkCard = $(`<div class="network-item" role="listitem"">
                            <div class="left">
                            <div class="dot" style="background:linear-gradient(180deg,#60a5fa,#3b82f6)"></div>
                            <div class="meta">
                                <div class="title">${network.interface}</div>
                                <div class="sub"> ${network.cidr}</div>
                            </div>
                            </div>
                            <div style="font-size:13px;color:var(--muted)"> ${$('.cards').children().length} hosts</div>
                        </div>
                        </div>
                    `);
                    $('.networks').append(networkCard)
            }
     
    })
    }

    $('.network-item').on('click', function () {

         network = $(this).children().children().children()[1].textContent.trim()
         selectedNetworkCIDR = network
         loadNetwork(network)
    });
}

$(document).ready(function () {
    console.log("LOADING!")
    loadAllNetworks();
//    $('.network-item').on('click', function () {
//     console.log("click click clcik")
//    });
});


//* Scan all the available network interfaces
function scanAllNetworks() {
    //alert("Scanning ALL the available networks. This might take a while, please wait.")

    fetch('/getAllNetworks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({empty: "" })
    })
    .then(res => res.json())
    .then(data => {
        console.log(data.networks)

    data.networks.forEach( network => {
        fetch('/loadNetworkData', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ network: network.cidr  })
        })
        .then(res => res.json())
        .then(data => {
            appendHostsAndNetworks(0, [network])
        })
    })

    })
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
        appendHostsAndNetworks(0, [data.networkData[0]])
    })
}

//* Load the target network hosts from the database

function loadNetwork(network) {
   
    fetch('/loadNetworkData', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ network })
    })
    .then(res => res.json())
    .then(data => {
        console.log(data)
        appendHostsAndNetworks(data.networkData, 0)
    })
}

function editDeviceCardInfo(cardElement) {
        card = cardElement
        inputName = $(card).find('input.name')
        inputOs = $(card).find('input.os')
        inputEdit =  $(card).find('button').first()
        inputEdit.text('Save');
        inputEdit.attr('onclick', `saveDeviceCardInfo()`)
        inputName.attr('disabled', false);
        inputName.addClass('editing');
        inputOs.addClass('editing');
        inputOs.attr('disabled', false);
        inputName.focus();
}

function saveDeviceCardInfo() {

        hostIP = $(card).find('div.ip').text();

        fetch('./updateHostInfo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({newName: inputName.val(), newOs: inputOs.val(), hostIP, networkCIDR: selectedNetworkCIDR  })
        })
        .then(res => res.json())
        .then(data => {
            inputEdit.text('Edit');
            inputName.attr('disabled', true);
            inputOs.attr('disabled', true);
            inputEdit.attr('onclick', `editDeviceCardInfo(this.closest('.device-card'))`)
            inputName.removeClass('editing');
            inputOs.removeClass('editing');
            console.log(data.message)
        })
}

//* For later: Pings every host from every network to check connectivity
// function pingAllHosts() {
//     fetch('/pingAllHosts', {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({ empty: "" })
//     })
//     .then(res => res.json())
//     .then(data => { 
//         console.log(data)
//     })
// }