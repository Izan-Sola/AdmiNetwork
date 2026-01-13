const fs = require('fs').promises;
const path = require('path');
const bodyParser = require("body-parser");
const ssh = require("ssh2");
const express = require('express');
const cors = require('cors');
const app = express();
const server = require('http').Server(app);
const rateLimiter = require('express-rate-limit');
const WebSocketServer = require("websocket").server;
const os = require('os');
const ip = require('ip');
const nmap = require('node-nmap');
const ping = require('ping');

//nmap.nmapLocation = "/usr/bin/nmap"
nmap.nmapLocation = "C:/Program Files (x86)/Nmap/nmap.exe"

let tempLogs = [];
let clientConn = null;
const DATA_FILE = path.join(__dirname, 'networks_data.json');

const rateLimit = rateLimiter({
    windowMs: 2 * 60 * 1000, // 2 minutes
    limit: 1000, // Limit each IP to 1000 requests per `window` (here, per 2 minutes).
    standardHeaders: 'draft-8', // draft-6: `RateLimit-*` headers; draft-7 & draft-8: combined `RateLimit` header
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers.
    ipv6Subnet: 56, // Set to 60 or 64 to be less aggressive, or 52 or 48 to be more aggressive. 
});
app.use(rateLimit);

app.set('port', 3001);
app.use(cors());
app.use(bodyParser.json());
app.use(express.json());
app.use(express.static('public'));

const NetWorkScanner = require('network-scanner-js');
const netScan = new NetWorkScanner();
require('events').EventEmitter.defaultMaxListeners = 50;
const networkInfo = require('network-info');

//? <------ WEBSOCKET ------>
const webSocketServer = new WebSocketServer({
    httpServer: server,
    autoAcceptConnections: false
});

webSocketServer.on("request", function (req) {
    if (req.origin === 'http://localhost:3001' || req.origin === 'http://172.30.199.117:3001'
        || req.origin === 'http://adminetwork.duckdns.org'
    ) {
        const connection = req.accept(null, req.origin);
        connection.on("close", function () {
            console.log("Server closed");
        });
        clientConn = connection;
    } else {
        req.reject();
    }
});

server.listen(3001, '0.0.0.0', () => {
    console.log('Server started');
});

//? <------ DATA STORAGE FUNCTIONS ------->

// Initialize or load data file
async function initializeDataFile() {
    try {
        await fs.access(DATA_FILE);
    } catch (error) {
        // File doesn't exist, create it with empty array
        await fs.writeFile(DATA_FILE, JSON.stringify({ networks: [] }, null, 2));
    }
}

// Load all networks data
async function loadNetworksData() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error loading networks data:', error);
        return { networks: [] };
    }
}

// Save networks data
async function saveNetworksData(data) {
    try {
        await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving networks data:', error);
        throw error;
    }
}

// Find network by CIDR
async function findNetworkByCIDR(cidr) {
    const data = await loadNetworksData();
    return data.networks.find(network => network.cidr === cidr);
}

// Find or create network
async function findOrCreateNetwork(networkInfo) {
    const data = await loadNetworksData();
    const existingNetworkIndex = data.networks.findIndex(n => n.cidr === networkInfo.cidr);
    
    if (existingNetworkIndex >= 0) {
        // Update existing network
        data.networks[existingNetworkIndex] = {
            ...data.networks[existingNetworkIndex],
            ...networkInfo,
            lastUpdated: getDate()
        };
    } else {
        // Add new network
        data.networks.push({
            ...networkInfo,
            hosts: [],
            createdAt: getDate(),
            lastUpdated: getDate()
        });
    }
    
    await saveNetworksData(data);
    return networkInfo.cidr;
}

// Add or update host in network
async function addOrUpdateHost(networkCIDR, hostData) {
    const data = await loadNetworksData();
    const networkIndex = data.networks.findIndex(n => n.cidr === networkCIDR);
    
    if (networkIndex === -1) {
        throw new Error(`Network ${networkCIDR} not found`);
    }
    
    const network = data.networks[networkIndex];
    const existingHostIndex = network.hosts.findIndex(h => h.host_ip === hostData.ip);
    
    if (existingHostIndex >= 0) {
        // Update existing host
        network.hosts[existingHostIndex] = {
            ...network.hosts[existingHostIndex],
            host_ip: hostData.ip,
            host_name: hostData.hostname || network.hosts[existingHostIndex].host_name,
            host_os: hostData.osNmap || network.hosts[existingHostIndex].host_os,
            openPorts: JSON.stringify(hostData.openPorts || []),
            last_ping: getDate(),
            isAlive: true,
            lastUpdated: getDate()
        };
    } else {
        // Add new host
        network.hosts.push({
            host_ip: hostData.ip,
            host_name: hostData.hostname || "unknown",
            host_os: hostData.osNmap || "unknown",
            openPorts: JSON.stringify(hostData.openPorts || []),
            last_ping: getDate(),
            isAlive: true,
            firstSeen: getDate(),
            lastUpdated: getDate()
        });
    }
    
    network.lastUpdated = getDate();
    await saveNetworksData(data);
}

// Update host details
async function updateHostDetails(hostIP, newName, newOs, networkCIDR) {
    const data = await loadNetworksData();
    const networkIndex = data.networks.findIndex(n => n.cidr === networkCIDR);
    
    if (networkIndex === -1) {
        throw new Error(`Network ${networkCIDR} not found`);
    }
    
    const hostIndex = data.networks[networkIndex].hosts.findIndex(h => h.host_ip === hostIP);
    
    if (hostIndex === -1) {
        throw new Error(`Host ${hostIP} not found in network ${networkCIDR}`);
    }
    
    data.networks[networkIndex].hosts[hostIndex].host_name = newName;
    data.networks[networkIndex].hosts[hostIndex].host_os = newOs;
    data.networks[networkIndex].hosts[hostIndex].lastUpdated = getDate();
    data.networks[networkIndex].lastUpdated = getDate();
    
    await saveNetworksData(data);
}

// Update host status
async function updateHostStatus(result) {
    const data = await loadNetworksData();
    const networkIndex = data.networks.findIndex(n => result.network_ip.includes(n.cidr));
    
    if (networkIndex === -1) {
        return;
    }
    
    const hostIndex = data.networks[networkIndex].hosts.findIndex(h => h.host_ip === result.ip);
    
    if (hostIndex === -1) {
        return;
    }
    
    data.networks[networkIndex].hosts[hostIndex].isAlive = result.status === 'up';
    data.networks[networkIndex].hosts[hostIndex].last_ping = getDate();
    data.networks[networkIndex].lastUpdated = getDate();
    
    await saveNetworksData(data);
}

// Remove host from network
async function removeHost(hostIP, networkCIDR) {
    const data = await loadNetworksData();
    const networkIndex = data.networks.findIndex(n => n.cidr === networkCIDR);
    
    if (networkIndex === -1) {
        throw new Error(`Network ${networkCIDR} not found`);
    }
    
    data.networks[networkIndex].hosts = data.networks[networkIndex].hosts.filter(
        h => h.host_ip !== hostIP
    );
    data.networks[networkIndex].lastUpdated = getDate();
    
    await saveNetworksData(data);
}

// Remove network
async function removeNetwork(networkCIDR) {
    const data = await loadNetworksData();
    data.networks = data.networks.filter(n => n.cidr !== networkCIDR);
    await saveNetworksData(data);
}

//? <------ NETWORK FUNCTIONS ------->

//* Endpoint for scanning every available network if possible
app.post('/getAllNetworks', async (req, res) => {
    await initializeDataFile();
    
    const networks = await getNetworksInfo({
        scanHosts: true
    });
    
    // Save the network metadata concurrently
    const savePromises = networks.map(network => findOrCreateNetwork(network));
    await Promise.allSettled(savePromises);

    res.json({ networks });
});

//* Gets the info of 1 or all network INTERFACES
async function getNetworksInfo(options = {}) {
    const {
        targetCIDR = null,
        scanHosts = false
    } = options;

    const interfaces = os.networkInterfaces();
    const networks = [];
    const scanPromises = [];

    for (const interfaceName in interfaces) {
        for (const iface of interfaces[interfaceName]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                const subnet = ip.subnet(iface.address, iface.netmask);
                const interfaceCIDR = `${subnet.networkAddress}/${subnet.subnetMaskLength}`;
                
                if (clientConn) {
                    clientConn.sendUTF(JSON.stringify({ 
                        network: interfaceCIDR, 
                        type: 'foundNetwork', 
                        msg: "" 
                    }));
                }
                
                if (targetCIDR) {
                    const [targetHostIP] = targetCIDR.split('/');
                    if (iface.address === targetHostIP) {
                        const networkSubnet = ip.cidrSubnet(targetCIDR);
                        const networkCIDR = `${networkSubnet.networkAddress}/${targetCIDR.split('/')[1]}`;

                        const networkInfo = {
                            interface: interfaceName,
                            ip: iface.address,
                            netmask: iface.netmask,
                            cidr: networkCIDR,
                            hostCIDR: targetCIDR
                        };
                        networks.push(networkInfo);

                        if (scanHosts) {
                            scanPromises.push(retrieveHostInfo(networkCIDR));
                        }
                    }
                } else {
                    const networkInfo = {
                        interface: interfaceName,
                        ip: iface.address,
                        netmask: iface.netmask,
                        cidr: interfaceCIDR
                    };
                    networks.push(networkInfo);
                    if (scanHosts) {
                        scanPromises.push(retrieveHostInfo(interfaceCIDR));
                    }
                }
            }
        }
    }

    if (scanHosts && scanPromises.length > 0) {
        console.log(`Waiting for ${scanPromises.length} network scans to complete...`);
        const scanResults = await Promise.allSettled(scanPromises);
        scanResults.forEach(result => {
            if (result.status === 'rejected') {
                console.error('One network scan failed:', result.reason);
            }
        });
        console.log('All network scans and host saves are complete.');
    }

    if (targetCIDR) {
        return networks.length > 0 ? networks : [];
    } else {
        return networks;
    }
}

//* Endpoint for scanning the specified network
app.post('/scanNetwork', async (req, res) => {
    await initializeDataFile();
    
    const networks = await getNetworksInfo({
        targetCIDR: req.body.subnet,
        scanHosts: true
    });
    
    if (networks && networks.length > 0) {
        await findOrCreateNetwork(networks[0]);
        res.json({ networks });
    } else {
        res.status(404).json({ error: 'Network not found or could not be scanned.' });
    }
});

//* Get advanced info of the host - RETURNS A PROMISE
function retrieveHostInfo(subnet) {
    return new Promise((resolve, reject) => {
        console.log(`Starting NMAP scan for subnet: ${subnet}`);

        const scan = new nmap.NmapScan(subnet, "-O");

        scan.once('complete', async (data) => {
            if (clientConn) {
                clientConn.sendUTF(JSON.stringify({ 
                    type: 'scanComplete', 
                    msg: '', 
                    network: subnet 
                }));
            }
            
            console.log(`NMAP found ${data.length} hosts in ${subnet}. Starting concurrent saves...`);

            const savePromises = data.map(hostData =>
                addOrUpdateHost(subnet, hostData).catch(err => {
                    console.error(`Error saving host ${hostData.ip}:`, err.message);
                    return { status: 'rejected', reason: err };
                })
            );

            Promise.allSettled(savePromises)
                .then(() => {
                    console.log(`All host save operations completed for ${subnet}`);
                    resolve({ subnet: subnet, hosts: data.length });
                })
                .catch(err => {
                    console.error(`Error during concurrent host saving coordination for ${subnet}:`, err);
                    resolve({ subnet: subnet, hosts: data.length, error: 'Internal save coordination failure' });
                });
        });

        scan.once('error', (err) => {
            console.error(`NMAP scan error for ${subnet}:`, err);
            reject(err);
        });
        scan.startScan();
    });
}

//* Update the name and operative system of the specified host
app.post('/updateHostDetails', async (req, res) => {
    const { hostIP, newName, newOs, networkCIDR } = req.body;

    if (!hostIP || !networkCIDR) {
        return res.status(400).json({ 
            success: false, 
            message: 'Host IP and Network CIDR are required.' 
        });
    }

    try {
        await updateHostDetails(hostIP, newName, newOs, networkCIDR);
        res.json({ 
            success: true, 
            message: `Host ${hostIP} updated successfully.` 
        });
    } catch (error) {
        console.error('Error updating host information:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to update host.', 
            error: error.message 
        });
    }
});

//* Ping every host in the list to check connectivity
app.post('/pingAllHosts', async (req, res) => {
    const hostsToPing = req.body.allHostsToPing;
    const pingPromises = hostsToPing.map(host =>
        ping.promise.probe(host.host_ip)
    );

    let results;
    try {
        results = await Promise.all(pingPromises);
    } catch (e) {
        console.error("An error occurred during one or more pings:", e);
        return res.status(500).json({ error: "Failed to complete all ping checks." });
    }
    
    const connectivityStatus = results.map((res, index) => {
        const networkIP = hostsToPing[index].network_ip;
        return {
            ip: res.numeric_host,
            network_ip: networkIP,
            status: res.alive ? 'up' : 'down',
            time: res.time,
            date: getDate()
        };
    });
    
    const updatePromises = connectivityStatus.map(result => updateHostStatus(result));
    await Promise.allSettled(updatePromises);
    
    res.json({ connectivityStatus });
});

//* Load network data
app.post('/loadNetworkData', async (req, res) => {
    await initializeDataFile();
    
    try {
        const data = await loadNetworksData();
        if (req.body.network && req.body.network !== "0") {
            const network = data.networks.find(n => n.cidr === req.body.network);
            res.json({ networkData: network || null });
        } else {
            res.json({ networkData: data.networks });
        }
    } catch (error) {
        console.error("Error loading network data:", error);
        res.status(500).json({ error: "Failed to load network data." });
    }
});

//* Retrieve ALL hosts of ALL networks
app.post('/getAllNetworksHosts', async (req, res) => {
    await initializeDataFile();
    
    try {
        const data = await loadNetworksData();
        const allHostsData = {};
        
        data.networks.forEach(network => {
            allHostsData[network.cidr] = network.hosts || [];
        });
        
        res.json({ allHostsData });
    } catch (error) {
        console.error("Error retrieving all network hosts:", error);
        res.status(500).json({ error: "Failed to retrieve all host data." });
    }
});

//* Remove a host from the network
app.post('/removeHost', async (req, res) => {
    const { hostIP, selectedNetworkCIDR } = req.body;
    
    if (!hostIP || !selectedNetworkCIDR) {
        return res.status(400).json({ 
            success: false, 
            message: 'Host IP and Network CIDR are required.' 
        });
    }
    
    try {
        await removeHost(hostIP, selectedNetworkCIDR);
        res.sendStatus(200);
    } catch (error) {
        console.error("Error removing host:", error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to remove host.' 
        });
    }
});

//* Remove a network
app.post('/removeNetwork', async (req, res) => {
    const { selectedNetworkCIDR } = req.body;
    
    if (!selectedNetworkCIDR) {
        return res.status(400).json({ 
            success: false, 
            message: 'Network CIDR is required.' 
        });
    }
    
    try {
        await removeNetwork(selectedNetworkCIDR);
        res.sendStatus(200);
    } catch (error) {
        console.error("Error removing network:", error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to remove network.' 
        });
    }
});

//? <------ SSH ----->
// (SSH code remains the same as in your original)

//? <------ SFTP ----->
// (SFTP code remains the same as in your original)

//? <------ UTILITY FUNCTIONS ------>

app.post('/updateLog', async (req, res) => {
    tempLogs.push(req.body.log);
    console.log(req.body.log);
    res.sendStatus(200);
});

app.post('/retrieveLog', async (req, res) => {
    console.log(tempLogs);
    res.json({ tempLogs });
});

function getDate() {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    const yyyy = String(now.getFullYear());

    return `${mm}/${dd}/${yyyy} at ${h}:${m}:${s}`;
}

// Initialize data file on startup
initializeDataFile().catch(console.error);