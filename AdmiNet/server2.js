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

// Add multiple hosts at once
async function addHosts(networkCIDR, hostsDataArray) {
    const data = await loadNetworksData();
    const networkIndex = data.networks.findIndex(n => n.cidr === networkCIDR);
    
    if (networkIndex === -1) {
        throw new Error(`Network ${networkCIDR} not found. Network should have been created before adding hosts.`);
    }
    
    const network = data.networks[networkIndex];
    const existingHostMap = new Map();
    
    // Create a map of existing hosts for quick lookup
    network.hosts.forEach(host => {
        existingHostMap.set(host.host_ip, host);
    });
    
    // Process each new host
    for (const hostData of hostsDataArray) {
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
        return result.network_ip === n.cidr
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
    
    // Get all network interfaces
    const interfaces = os.networkInterfaces();
    const networks = [];
    
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
                
                const networkInfo = {
                    interface: interfaceName,
                    ip: iface.address,
                    netmask: iface.netmask,
                    cidr: interfaceCIDR
                };
                networks.push(networkInfo);
            }
        }
    }
    
    console.log(`Found ${networks.length} network interfaces`);
    
    // Create all networks sequentially
    const createdNetworks = [];
    for (const network of networks) {
        try {
            await findOrCreateNetwork(network);
            createdNetworks.push(network);
            console.log(`Created network: ${network.cidr}`);
        } catch (error) {
            console.error(`Failed to create network ${network.cidr}:`, error.message);
        }
    }
    
    // For each network, scan its hosts sequentially
    for (const network of createdNetworks) {
        try {
            console.log(`Starting NMAP scan for network: ${network.cidr}`);
            await new Promise((resolve, reject) => {
                const scan = new nmap.NmapScan(network.cidr, "-O");
                
                scan.once('complete', async (data) => {
                    if (clientConn) {
                        clientConn.sendUTF(JSON.stringify({ 
                            type: 'scanComplete', 
                            msg: '', 
                            network: network.cidr 
                        }));
                    }
                    
                    console.log(`NMAP found ${data.length} hosts in ${network.cidr}. Saving hosts...`);
                    
                    try {
                        // Network should exist at this point
                        await addHosts(network.cidr, data);
                        console.log(`Successfully saved ${data.length} hosts for network ${network.cidr}`);
                        resolve({ network: network.cidr, hosts: data.length, success: true });
                    } catch (error) {
                        console.error(`Error saving hosts for ${network.cidr}:`, error);
                        reject(error);
                    }
                });
                
                scan.once('error', (err) => {
                    console.error(`NMAP scan error for ${network.cidr}:`, err);
                    reject(err);
                });
                
                scan.startScan();
            });
        } catch (error) {
            console.error(`Failed to scan network ${network.cidr}:`, error.message);
        }
    }
    
    res.json({ networks: createdNetworks });
});

//* Endpoint for scanning the specified network
app.post('/scanNetwork', async (req, res) => {
    await initializeDataFile();
    
    if (!req.body || !req.body.subnet) {
        return res.status(400).json({ error: 'Subnet is required' });
    }
    
    const targetCIDR = req.body.subnet;
    const interfaces = os.networkInterfaces();
    let networkInfo = null;
    
    // Find matching interface
    for (const interfaceName in interfaces) {
        for (const iface of interfaces[interfaceName]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                const [targetHostIP] = targetCIDR.split('/');
                if (iface.address === targetHostIP) {
                    const networkSubnet = ip.cidrSubnet(targetCIDR);
                    const networkCIDR = `${networkSubnet.networkAddress}/${targetCIDR.split('/')[1]}`;
                    
                    networkInfo = {
                        interface: interfaceName,
                        ip: iface.address,
                        netmask: iface.netmask,
                        cidr: networkCIDR,
                        hostCIDR: targetCIDR
                    };
                    break;
                }
            }
        }
        if (networkInfo) break;
    }
    
    if (!networkInfo) {
        // No matching interface found
        console.log(`No matching interface found for ${targetCIDR}, creating network entry.`);
        const networkParts = targetCIDR.split('/');
        networkInfo = {
            interface: 'Unknown',
            ip: networkParts[0],
            netmask: '255.255.255.0',
            cidr: targetCIDR
        };
    }
    
    //Create the network and scan the hosts
    await findOrCreateNetwork(networkInfo);
    console.log(`Created network: ${networkInfo.cidr}`);
    
    try {
        await new Promise((resolve, reject) => {
            const scan = new nmap.NmapScan(targetCIDR, "-O");
            
            scan.once('complete', async (data) => {
                if (clientConn) {
                    clientConn.sendUTF(JSON.stringify({ 
                        type: 'scanComplete', 
                        msg: '', 
                        network: targetCIDR 
                    }));
                }
                
                console.log(`NMAP found ${data.length} hosts in ${targetCIDR}. Saving hosts...`);
                
                try {
                    await addHosts(targetCIDR, data);
                    console.log(`Successfully saved ${data.length} hosts for network ${targetCIDR}`);
                    resolve({ network: targetCIDR, hosts: data.length, success: true });
                } catch (error) {
                    console.error(`Error saving hosts for ${targetCIDR}:`, error);
                    reject(error);
                }
            });
            
            scan.once('error', (err) => {
                console.error(`NMAP scan error for ${targetCIDR}:`, err);
                reject(err);
            });
            
            scan.startScan();
        });
        
        res.json({ networks: [networkInfo], success: true });
    } catch (error) {
        console.error('Network scan failed:', error);
        res.status(500).json({ 
            error: 'Network scan failed', 
            details: error.message,
            network: networkInfo 
        });
    }
});

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
    
    // Update statuses sequentially 
    for (const result of connectivityStatus) {
        await updateHostStatus(result);
    }
    
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



//? <----- SSH ----->

webSocketServer.on('request', function (req) {
    if (req.resource === '/ssh') {
        //   const connection = req.accept(null, req.origin);
        let sshClient;

        clientConn.on('message', async function (message) {
            const data = JSON.parse(message.utf8Data);

            if (data.ip && data.user && data.pass) {
                sshClient = new ssh.Client();
                sshClient.on('ready', () => {
                    clientConn.sendUTF('\x1b[32mSSH Connected!\x1b[0m\r\n$ ');
                    sshClient.shell((err, stream) => {
                        if (err) return clientConn.sendUTF('Error opening shell\r\n');
                        stream.on('data', chunk => clientConn.sendUTF(chunk.toString()));
                        stream.on('close', () => sshClient.end());
                        clientConn.on('message', msg => {
                            const cmdData = JSON.parse(msg.utf8Data);
                            if (cmdData.cmd) stream.write(cmdData.cmd);
                        });
                    });
                }).connect({
                    host: data.ip,
                    port: 22,
                    username: data.user,
                    password: data.pass
                });

                sshClient.on('error', err => {                    
                tempLogs.push({
                    ip: data.ip,
                    action: "ssh",
                    type: "error",
                    message: `User "${data.user}" attempted connecting to this device via SSH.\n 
                    \x1b[31mSSH Error: ${err.message}\x1b[0m\r\n`,
                    timestamp: getDate()
                })
            });

            sshClient.on('ready', msg => {
                console.log(msg)
                clientConn.sendUTF(
                JSON.stringify({ message: `"${data.user}" has successfully connected to this device via SHH`, type: "info"}))
                tempLogs.push({
                    ip: data.ip,
                    action: "ssh",
                    type: error,
                    message: `"${data.user}" has successfully connected to this device via SHH`,
                    timeStamp: getDate()
                })
            })
            } else if (data.cmd && sshClient) {
                // handled by terminal listener
            }
        });

        clientConn.on('close', () => { if (sshClient) sshClient.end(); });
    } else {
        // req.reject();
    }
});

//? <----- SFTP ----->

const SftpClient = require('ssh2-sftp-client');
const multer = require('multer');
const { client } = require('websocket')
const upload = multer({ dest: 'uploads/' });

//* List the current directory
app.post('/api/list', async (req, res) => {
    const { username, password, dir } = req.body;
    const ip = req.body.ip || sessionStorage.getItem('ssh_ip'); // optional dynamic IP from client

    if (!username || !password) return res.json({ success: false, error: 'Missing credentials' });

    const sftp = new SftpClient();
    try {
        await sftp.connect({
            host: ip,
            port: 22,
            username,
            password
        });
        const files = await sftp.list(dir || '.');
        await sftp.end();
        res.json({ success: true, files });

    } catch (err) {
        console.error('SFTP list error:', err);
        res.json({ success: false, error: err.message });
    }
});

//* Download selected file
//TODO: Compress and download folders
app.post('/api/download', async (req, res) => {
    const { username, password, filePath, ip } = req.body;
    if (!filePath) return res.status(400).send('Missing file path');

    const sftp = new SftpClient();
    const tempPath = path.join(__dirname, 'uploads', path.basename(filePath));

    try {
        await sftp.connect({
            host: ip,
            port: 22,
            username,
            password
        });
        await sftp.fastGet(filePath, tempPath);
        await sftp.end();
        res.download(tempPath);
    } catch (err) {
        console.error('SFTP download error:', err);
        res.status(500).send('Error downloading file');
    }
});

//* Upload stuff
app.post('/api/upload', upload.single('file'), async (req, res) => {
    const { username, password, remoteDir, ip } = req.body;
    const localFilePath = req.file.path;
    const remoteFileName = req.file.originalname;

    const sftp = new SftpClient();
    try {
        await sftp.connect({
            host: ip,
            port: 22,
            username,
            password
        });
        await sftp.fastPut(localFilePath, path.posix.join(remoteDir, remoteFileName));
        await sftp.end();
        res.sendStatus(200);
    } catch (err) {
        console.error('SFTP upload error:', err);
        res.status(500).json({ error: 'Upload failed' });
    }
});