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
        // Try to read and parse to ensure it's valid JSON
        const data = await fs.readFile(DATA_FILE, 'utf8');
        JSON.parse(data);
    } catch (error) {
        // File doesn't exist or is invalid, create it with empty array
        console.log('Initializing or repairing data file...');
        await fs.writeFile(DATA_FILE, JSON.stringify({ networks: [] }, null, 2));
    }
}

// Load all networks data with error handling
async function loadNetworksData() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        // Clean up any trailing commas or invalid JSON
        const cleanedData = data.trim();
        return JSON.parse(cleanedData);
    } catch (error) {
        console.error('Error loading networks data:', error.message);
        // If file is corrupt, recreate it
        await initializeDataFile();
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
        // Update existing network but preserve hosts
        data.networks[existingNetworkIndex] = {
            ...data.networks[existingNetworkIndex],
            interface: networkInfo.interface || data.networks[existingNetworkIndex].interface,
            ip: networkInfo.ip || data.networks[existingNetworkIndex].ip,
            netmask: networkInfo.netmask || data.networks[existingNetworkIndex].netmask,
            lastUpdated: getDate()
        };
    } else {
        // Add new network
        const newNetwork = {
            ...networkInfo,
            hosts: [],
            createdAt: getDate(),
            lastUpdated: getDate()
        };
        data.networks.push(newNetwork);
        console.log(`Created new network: ${networkInfo.cidr}`);
    }
    
    await saveNetworksData(data);
    return networkInfo.cidr;
}

// Ensure network exists before adding hosts
async function ensureNetworkExists(networkCIDR, networkInfo = null) {
    const network = await findNetworkByCIDR(networkCIDR);
    if (!network) {
        // Create a minimal network entry
        const networkParts = networkCIDR.split('/');
        const networkIP = networkParts[0];
        const subnetMask = parseInt(networkParts[1]);
        
        // Calculate netmask from CIDR
        const mask = [];
        for (let i = 0; i < 4; i++) {
            const bits = Math.min(8, Math.max(0, subnetMask - i * 8));
            mask.push(bits ? 256 - Math.pow(2, 8 - bits) : 0);
        }
        const netmask = mask.join('.');
        
        const newNetworkInfo = networkInfo || {
            interface: 'Unknown',
            ip: networkIP,
            netmask: netmask,
            cidr: networkCIDR
        };
        
        await findOrCreateNetwork(newNetworkInfo);
        console.log(`Auto-created network: ${networkCIDR}`);
    }
}

// Process host data from NMAP to ensure it's properly structured
function processHostData(hostData) {
    // Deep clone the hostData to avoid reference issues
    const processed = JSON.parse(JSON.stringify(hostData));
    
    // Ensure all required fields exist
    return {
        ip: processed.ip || '',
        hostname: processed.hostname || 'unknown',
        osNmap: processed.osNmap || 'unknown',
        openPorts: Array.isArray(processed.openPorts) ? processed.openPorts : []
    };
}

// Add or update host in network
async function addOrUpdateHost(networkCIDR, rawHostData) {
    // Process the host data first
    const hostData = processHostData(rawHostData);
    
    // First ensure the network exists
    await ensureNetworkExists(networkCIDR);
    
    const data = await loadNetworksData();
    const networkIndex = data.networks.findIndex(n => n.cidr === networkCIDR);
    
    if (networkIndex === -1) {
        throw new Error(`Network ${networkCIDR} not found even after attempting to create it`);
    }
    
    const network = data.networks[networkIndex];
    const existingHostIndex = network.hosts.findIndex(h => h.host_ip === hostData.ip);
    
    if (existingHostIndex >= 0) {
        // Update existing host - create a new object to avoid reference issues
        const existingHost = network.hosts[existingHostIndex];
        network.hosts[existingHostIndex] = {
            host_ip: hostData.ip,
            host_name: hostData.hostname || existingHost.host_name,
            host_os: hostData.osNmap || existingHost.host_os,
            openPorts: JSON.stringify(hostData.openPorts || []),
            last_ping: existingHost.last_ping || getDate(),
            isAlive: existingHost.isAlive !== undefined ? existingHost.isAlive : true,
            firstSeen: existingHost.firstSeen || getDate(),
            lastUpdated: getDate()
        };
        console.log(`Updated host: ${hostData.ip} in network ${networkCIDR}`);
    } else {
        // Add new host - create a fresh object
        const newHost = {
            host_ip: hostData.ip,
            host_name: hostData.hostname || "unknown",
            host_os: hostData.osNmap || "unknown",
            openPorts: JSON.stringify(hostData.openPorts || []),
            last_ping: getDate(),
            isAlive: true,
            firstSeen: getDate(),
            lastUpdated: getDate()
        };
        network.hosts.push(newHost);
        console.log(`Added new host: ${hostData.ip} to network ${networkCIDR} (total: ${network.hosts.length})`);
    }
    
    network.lastUpdated = getDate();
    await saveNetworksData(data);
}

// Add multiple hosts at once (to avoid race conditions)
async function addMultipleHosts(networkCIDR, hostsDataArray) {
    // First ensure the network exists
    await ensureNetworkExists(networkCIDR);
    
    const data = await loadNetworksData();
    const networkIndex = data.networks.findIndex(n => n.cidr === networkCIDR);
    
    if (networkIndex === -1) {
        throw new Error(`Network ${networkCIDR} not found even after attempting to create it`);
    }
    
    const network = data.networks[networkIndex];
    const existingHostMap = new Map();
    
    // Create a map of existing hosts for quick lookup
    network.hosts.forEach(host => {
        existingHostMap.set(host.host_ip, host);
    });
    
    // Process each new host
    for (const rawHostData of hostsDataArray) {
        const hostData = processHostData(rawHostData);
        
        if (existingHostMap.has(hostData.ip)) {
            // Update existing host
            const existingHost = existingHostMap.get(hostData.ip);
            const updatedHost = {
                host_ip: hostData.ip,
                host_name: hostData.hostname || existingHost.host_name,
                host_os: hostData.osNmap || existingHost.host_os,
                openPorts: JSON.stringify(hostData.openPorts || []),
                last_ping: existingHost.last_ping || getDate(),
                isAlive: existingHost.isAlive !== undefined ? existingHost.isAlive : true,
                firstSeen: existingHost.firstSeen || getDate(),
                lastUpdated: getDate()
            };
            
            // Find and update in the array
            const hostIndex = network.hosts.findIndex(h => h.host_ip === hostData.ip);
            if (hostIndex !== -1) {
                network.hosts[hostIndex] = updatedHost;
            }
        } else {
            // Add new host
            const newHost = {
                host_ip: hostData.ip,
                host_name: hostData.hostname || "unknown",
                host_os: hostData.osNmap || "unknown",
                openPorts: JSON.stringify(hostData.openPorts || []),
                last_ping: getDate(),
                isAlive: true,
                firstSeen: getDate(),
                lastUpdated: getDate()
            };
            network.hosts.push(newHost);
            existingHostMap.set(hostData.ip, newHost);
        }
    }
    
    console.log(`Processed ${hostsDataArray.length} hosts for network ${networkCIDR}, total hosts: ${network.hosts.length}`);
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
    
    // Find network by checking if result.network_ip contains any network CIDR
    const networkIndex = data.networks.findIndex(n => {
        // Try different ways to match the network
        return result.network_ip === n.cidr || 
               result.network_ip.includes(n.cidr.split('/')[0]) ||
               n.cidr.includes(result.network_ip.split('.')[0]);
    });
    
    if (networkIndex === -1) {
        console.log(`Network not found for ping result: ${result.network_ip}`);
        return;
    }
    
    const hostIndex = data.networks[networkIndex].hosts.findIndex(h => h.host_ip === result.ip);
    
    if (hostIndex === -1) {
        console.log(`Host ${result.ip} not found in network ${data.networks[networkIndex].cidr}`);
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
    
    const initialCount = data.networks[networkIndex].hosts.length;
    data.networks[networkIndex].hosts = data.networks[networkIndex].hosts.filter(
        h => h.host_ip !== hostIP
    );
    const finalCount = data.networks[networkIndex].hosts.length;
    
    if (initialCount !== finalCount) {
        console.log(`Removed host ${hostIP} from network ${networkCIDR}`);
    }
    
    data.networks[networkIndex].lastUpdated = getDate();
    
    await saveNetworksData(data);
}

// Remove network
async function removeNetwork(networkCIDR) {
    const data = await loadNetworksData();
    const initialCount = data.networks.length;
    data.networks = data.networks.filter(n => n.cidr !== networkCIDR);
    const finalCount = data.networks.length;
    
    if (initialCount !== finalCount) {
        console.log(`Removed network ${networkCIDR}`);
    }
    
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
                            scanPromises.push(retrieveHostInfo(networkCIDR, networkInfo));
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
                        scanPromises.push(retrieveHostInfo(interfaceCIDR, networkInfo));
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
            } else if (result.status === 'fulfilled') {
                console.log('Scan completed:', result.value);
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
    
    if (!req.body || !req.body.subnet) {
        return res.status(400).json({ error: 'Subnet is required' });
    }
    
    const networks = await getNetworksInfo({
        targetCIDR: req.body.subnet,
        scanHosts: true
    });
    
    if (networks && networks.length > 0) {
        await findOrCreateNetwork(networks[0]);
        res.json({ networks });
    } else {
        // Even if we didn't find a matching interface, we can still scan the network
        console.log(`No matching interface found for ${req.body.subnet}, but will scan it anyway.`);
        
        // Create a network entry for this CIDR
        const networkParts = req.body.subnet.split('/');
        const networkInfo = {
            interface: 'Unknown',
            ip: networkParts[0],
            netmask: '255.255.255.0', // Default assumption
            cidr: req.body.subnet
        };
        
        await findOrCreateNetwork(networkInfo);
        
        // Scan the network
        await retrieveHostInfo(req.body.subnet, networkInfo);
        
        res.json({ networks: [networkInfo] });
    }
});

//* Get advanced info of the host - RETURNS A PROMISE
function retrieveHostInfo(subnet, networkInfo = null) {
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
            
            console.log(`NMAP found ${data.length} hosts in ${subnet}. Saving all hosts at once...`);
            
            try {
                // Use addMultipleHosts to avoid race conditions and ensure all hosts are saved
                await addMultipleHosts(subnet, data);
                console.log(`Successfully saved ${data.length} hosts for network ${subnet}`);
                resolve({ subnet: subnet, hosts: data.length, success: true });
            } catch (error) {
                console.error(`Error saving multiple hosts for ${subnet}:`, error);
                // Fallback to individual saves
                console.log('Falling back to individual host saves...');
                
                const savePromises = data.map(hostData =>
                    addOrUpdateHost(subnet, hostData).catch(err => {
                        console.error(`Error saving host ${hostData.ip}:`, err.message);
                        return { status: 'rejected', reason: err };
                    })
                );

                Promise.allSettled(savePromises)
                    .then(() => {
                        console.log(`All host save operations completed for ${subnet}`);
                        resolve({ subnet: subnet, hosts: data.length, success: true });
                    })
                    .catch(err => {
                        console.error(`Error during concurrent host saving coordination for ${subnet}:`, err);
                        resolve({ subnet: subnet, hosts: data.length, error: 'Internal save coordination failure' });
                    });
            }
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
    if (!req.body || !req.body.allHostsToPing) {
        return res.status(400).json({ error: "No hosts provided to ping." });
    }
    
    const hostsToPing = req.body.allHostsToPing;
    const pingPromises = hostsToPing.map(host =>
        ping.promise.probe(host.host_ip || host.ip)
    );

    let results;
    try {
        results = await Promise.all(pingPromises);
    } catch (e) {
        console.error("An error occurred during one or more pings:", e);
        return res.status(500).json({ error: "Failed to complete all ping checks." });
    }
    
    const connectivityStatus = results.map((res, index) => {
        const host = hostsToPing[index];
        return {
            ip: res.numeric_host || host.host_ip || host.ip,
            network_ip: host.network_ip || host.networkCIDR || 'unknown',
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

// Debug endpoint to view raw data file
app.get('/debug/data', async (req, res) => {
    try {
        const rawData = await fs.readFile(DATA_FILE, 'utf8');
        res.type('text/plain').send(rawData);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Debug endpoint to view detailed stats
app.get('/debug/stats', async (req, res) => {
    try {
        const data = await loadNetworksData();
        const stats = {
            totalNetworks: data.networks.length,
            totalHosts: data.networks.reduce((sum, network) => sum + (network.hosts ? network.hosts.length : 0), 0),
            networks: data.networks.map(network => ({
                cidr: network.cidr,
                hostCount: network.hosts ? network.hosts.length : 0,
                hosts: network.hosts ? network.hosts.map(h => h.host_ip) : []
            }))
        };
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Debug endpoint to reset data file
app.post('/debug/reset', async (req, res) => {
    try {
        await fs.writeFile(DATA_FILE, JSON.stringify({ networks: [] }, null, 2));
        res.json({ success: true, message: 'Data file reset' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Initialize data file on startup
initializeDataFile().then(() => {
    console.log('Data file initialized');
}).catch(err => {
    console.error('Failed to initialize data file:', err);
});