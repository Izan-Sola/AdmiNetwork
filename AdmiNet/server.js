const mysql = require('mysql2/promise')
const bodyParser = require("body-parser")
const ssh = require("ssh2")
const express = require('express')
const cors = require('cors')
const app = express()
const server = require('http').Server(app)
const rateLimiter = require('express-rate-limit')
const WebSocketServer = require("websocket").server
const os = require('os')
const ip = require('ip')
const nmap = require('node-nmap')

const ping = require('ping');
nmap.nmapLocation = "/usr/bin/nmap"
let clientConn = null;
const rateLimit = rateLimiter({
    windowMs: 2 * 60 * 1000, // 2 minutes
    limit: 1000, // Limit each IP to 1000 requests per `window` (here, per 2 minutes).
    standardHeaders: 'draft-8', // draft-6: `RateLimit-*` headers; draft-7 & draft-8: combined `RateLimit` header
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers.
    ipv6Subnet: 56, // Set to 60 or 64 to be less aggressive, or 52 or 48 to be more aggressive. 
})
app.use(rateLimit)

const pool = mysql.createPool({
    host: "localhost",
    user: "root",
    password: "1234567890",
    port: 3306,
    database: "netscan",
    waitForConnections: true,
    connectionLimit: 15,
    queueLimit: 0
})

app.set('port', 3001)
app.use(cors())
app.use(bodyParser.json())
app.use(express.json())
app.use(express.static('public'))
const path = require('path')

const NetWorkScanner = require('network-scanner-js')
const netScan = new NetWorkScanner()
require('events').EventEmitter.defaultMaxListeners = 50 
const networkInfo = require('network-info')
const { table } = require('console')

//? <------ WEBSOCKET ------>
const webSocketServer = new WebSocketServer({
    httpServer: server,
    autoAcceptConnections: false 
})

webSocketServer.on("request", function (req) {
    if (req.origin === 'http://localhost:3001' || req.origin === 'http://adminetwork.duckdns.org') {
    const connection = req.accept(null, req.origin)
        connection.on("close", function () {
                    console.log("Server closed")
        })
        clientConn = connection;
    } else {
        req.reject()
    }
})
//TODO: SSH CONNECTION, COLUMN FOR PORT AND SERVICE INFO...
server.listen(3001, '0.0.0.0', () => {
    console.log('Server started on 192.168.18.48')
})

//? <------ NETWORK FUNCTIONS ------->

//* Endpoint for scanning every available network if possible
app.post('/getAllNetworks', async (req, res) => {

    const networks = await getNetworksInfo({
        scanHosts: true
    })
    //Save the network metadata concurrently.
    const savePromises = networks.map(network => saveNetworkInfo(network))
    await Promise.allSettled(savePromises) 

    res.json({ networks })
})

//* Gets the info of 1 or all network INTERFACES, whether there is a targetCIDR or not, and scans all the hosts if specified
async function getNetworksInfo(options = {}) {
    const {
        targetCIDR = null,    
        scanHosts = false    
    } = options

    const interfaces = os.networkInterfaces()
    const networks = []
    const scanPromises = [] 

    for (const interfaceName in interfaces) {
        
        for (const iface of interfaces[interfaceName]) {
      
            if (iface.family === 'IPv4' && !iface.internal) {
                const subnet = ip.subnet(iface.address, iface.netmask)
                const interfaceCIDR = `${subnet.networkAddress}/${subnet.subnetMaskLength}`
                clientConn.sendUTF(JSON.stringify({ network: interfaceCIDR, type: 'foundNetwork', msg: "" }))
                if (targetCIDR) {
                    const [targetHostIP] = targetCIDR.split('/')           
                    if (iface.address === targetHostIP) {
                        const networkSubnet = ip.cidrSubnet(targetCIDR)
                        const networkCIDR = `${networkSubnet.networkAddress}/${targetCIDR.split('/')[1]}`
                        
                        const networkInfo = {
                            interface: interfaceName,
                            ip: iface.address,          
                            netmask: iface.netmask,      
                            cidr: networkCIDR,           
                            hostCIDR: targetCIDR        
                        }
                        networks.push(networkInfo)
                                        
                        if (scanHosts) {
                            scanPromises.push(retrieveHostInfo(networkCIDR))
                        }
                    }
                } else {             
                    const networkInfo = {
                        interface: interfaceName,
                        ip: iface.address,
                        netmask: iface.netmask,
                        cidr: interfaceCIDR
                    }
                    networks.push(networkInfo)
                    if (scanHosts) {
                        scanPromises.push(retrieveHostInfo(interfaceCIDR))
                    }
                }
           }
        }
    }

    if (scanHosts && scanPromises.length > 0) {
        console.log(`Waiting for ${scanPromises.length} network scans to complete...`)
        const scanResults = await Promise.allSettled(scanPromises)
        scanResults.forEach(result => {
             if (result.status === 'rejected') {
                 console.error('One network scan failed:', result.reason)
             }
        })
        console.log('All network scans and host saves are complete.')
    }

    if (targetCIDR) {
        return networks.length > 0 ? networks : []
    } else {
        return networks
    }
}

//* Endpoint for scanning the specified network and insert each active host into the database
app.post('/scanNetwork', async (req, res) => {
    const networks = await getNetworksInfo({
        targetCIDR: req.body.subnet,
        scanHosts: true
    })
    if (networks && networks.length > 0) {
        await saveNetworkInfo(networks[0])
        res.json({ networks })
    } else {
        res.status(404).json({ error: 'Network not found or could not be scanned.' })
    }
})



//* Get advanced info of the host - RETURNS A PROMISE
function retrieveHostInfo(subnet) {
    return new Promise((resolve, reject) => {
        console.log(`Starting NMAP scan for subnet: ${subnet}`)
        
        const scan = new nmap.NmapScan(subnet, "-O")
        
        scan.once('complete', (data) => {
            clientConn.sendUTF(JSON.stringify({ type: 'scanComplete', msg: '', network: subnet}))
            console.log(`NMAP found ${data.length} hosts in ${subnet}. Starting concurrent saves...`)
            

            const savePromises = data.map(hostData =>
                saveHostsInfo(subnet, hostData).catch(err => {
                    console.error(`Error saving host ${hostData.ip}:`, err.message)
                    return { status: 'rejected', reason: err } 
                })
            )
            
            Promise.allSettled(savePromises)
                .then(() => {
                    console.log(`All host save operations completed for ${subnet}`)
                    resolve({ subnet: subnet, hosts: data.length }) 
                })
                .catch(err => {
                    
                    console.error(`Error during concurrent host saving coordination for ${subnet}:`, err)
                    resolve({ subnet: subnet, hosts: data.length, error: 'Internal save coordination failure' })
                })
        })
        
        scan.once('error', (err) => {
            console.error(`NMAP scan error for ${subnet}:`, err)
            reject(err) 
        })
        scan.startScan()
    })
}


//* Update the name and operative system of the specified host
app.post('/updateHostDetails', async (req, res) => {
    const { hostIP, newName, newOs, networkCIDR } = req.body;

    if (!hostIP || !networkCIDR) {
        return res.status(400).json({ success: false, message: 'Host IP and Network CIDR are required.' });
    }

    try {
        await updateHostDetails(hostIP, newName, newOs, networkCIDR);
        res.json({ success: true, message: `Host ${hostIP} updated successfully.` });
    } catch (error) {
        console.error('Error updating host information:', error);
        res.status(500).json({ success: false, message: 'Failed to update host in database.', error: error.message });
    }
});

//* Ping every host in the list to check connectivity
app.post('/pingAllHosts', async (req, res) => {

    const hostsToPing = req.body.allHostsToPing; 
    const pingPromises = hostsToPing.map(host => 
        ping.promise.probe(host.host_ip)
    );

    let results;
    try { results = await Promise.all(pingPromises);
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
    for ( const result of connectivityStatus ) {
        updateHostStatus(result)
    } 
    res.json({ connectivityStatus });
});

//? <----- DATABASE FUNCTIONS ----->

//* Update the status and the last ping date of the host
async function updateHostStatus(result) {
    //console.log(result)
    const con = await getDatabaseConnection()
    const now = getDate()
    try {   
        const isAlive = (result.status == 'up') ? true : false
        const hostIP = result.ip
        const tableName = convertIPtoTableName(result.network_ip)
        const updateStatus = `UPDATE IGNORE ${tableName} SET isAlive = ?, last_ping = ? WHERE host_ip = ?`
        await con.query(updateStatus, [ isAlive, now, hostIP ])
    }
    catch (e) {
        console.log("Error on updating host stauts: ", e)
    }
    finally {
        con.release()
    }
}

//* Create a new table for the network if it doesnt exist, and insert the host
async function saveHostsInfo(network, hostData) {

    const tableName = convertIPtoTableName(network)
    const con = await getDatabaseConnection() // Use pool
    console.log(hostData)
    try {
        await createNetworkTableIfNotExists(tableName, con) 

        const insertHost = `INSERT IGNORE INTO ${tableName} SET network_ip = ?,
                            host_ip = ?, host_name = ?, host_os = ?, openPorts = ?`
        await con.query(insertHost, [
            network, 
            hostData.ip, 
            hostData.hostname,
            hostData.osNmap,
            JSON.stringify(hostData.openPorts)
        ])

        return { message: 'Host saved successfully', host: hostData.ip }

    } catch (err) {
        console.error('Database error for host', hostData.ip, ':', err)
        throw err
    } finally {
        if (con) con.release()
    }
}

//* Upload the network infromation to the database
async function saveNetworkInfo(network) {

    const con = await getDatabaseConnection() // Use pool

        try {
            const insertNetwork = `INSERT IGNORE INTO networks_data SET cidr = ?, interface = ?, netmask = ?`
            await con.query(insertNetwork, [ network.cidr, network.interface, network.netmask ])
        } catch (err) {
            console.error('Database error when inserting networkdata', network, err)
        } finally {
            if (con) con.release() 
        }

}

app.post('/loadNetworkData', async (req, res) => {
  const [networkData] = await loadNetworkData(req.body.network)
  res.json({ networkData })
})
//* Retrieve the data of all the networks, or only (?the hosts of?) a target network
async function loadNetworkData(targetCIDR) {

    const tableName = convertIPtoTableName(targetCIDR)
    const con = await getDatabaseConnection() // Use pool

        try {
            if(targetCIDR != 0) {
                const getHostsData = `SELECT * FROM ${tableName}`
                const hostsData = await con.query(getHostsData)
                return hostsData
            }
            else {
                 const getNetworkData = `SELECT * FROM networks_data`
                 const networkData = con.query(getNetworkData)
                 
                 return networkData
            }
        } catch (error) {           
            console.error("Error trying to retrieve network data: ", error)
            return []
        } finally {
            if (con) con.release() // CRITICAL: Release connection back to pool
        }
}

//* Update the name and operative system of the specified host
async function updateHostDetails(hostIP, newName, newOs, networkCIDR) {
    const tableName = convertIPtoTableName(networkCIDR);
    const con = await getDatabaseConnection();

    try {
        const updateHost = `UPDATE ${tableName} SET host_name = ?, host_os = ? WHERE host_ip = ?;`;   
        const [result] = await con.query(updateHost, [newName, newOs, hostIP ]);

        return { message: 'Update successful', result};

    } catch (err) {
        console.error('Database error during host update:', err);
        throw err;
    } finally {
        con.release();
    }
}


//* Retrieve ALL hosts of ALL networks and return as a map for caching {cidr: [hosts]}
app.post('/getAllNetworksHosts', async (req, res) => {
    const con = await getDatabaseConnection();
    const allHostsData = {}; 
    
    try {
        const getNetworks = `SELECT cidr FROM networks_data`;
        const [networkList] = await con.query(getNetworks); 

        const fetchPromises = networkList.map(async (network) => {
            const tableName = convertIPtoTableName(network.cidr);
            const getHosts = `SELECT * FROM ${tableName}`;          
            const [hostList] = await con.query(getHosts); 
            allHostsData[network.cidr] = hostList;
        });

        await Promise.all(fetchPromises);
        res.json({ allHostsData });

    } catch (error) {
        console.error("Error retrieving all network hosts for caching:", error);
        res.status(500).json({ error: "Failed to retrieve all host data." });
    } finally {
        con.release();
    }
})

//* Remove a host from the table
app.post('/removeHost', async (req, res) => {
    const con = await getDatabaseConnection()
    const tableName = convertIPtoTableName(req.body.selectedNetworkCIDR)
    try {
        con.query(`DELETE FROM ${tableName} WHERE host_ip = ?`, [req.body.hostIP]) 
    } catch (error) {
        console.log("Error deleting the host", error, req.body.hostIP) 
    } finally { 
        res.sendStatus(200)
        con.release() }
}) 

//* Remove a network from the databse

app.post('/removeNetwork', async (req, res) => {
    const con = await getDatabaseConnection()
    const tableName = convertIPtoTableName(req.body.selectedNetworkCIDR)
    console.log(tableName)
    try {
        await con.query(`DROP TABLE IF EXISTS ${tableName}`)
        removeNetworkData = `DELETE FROM networks_data WHERE cidr = ?`
        await con.query(removeNetworkData, [req.body.selectedNetworkCIDR])
    } catch (error) {
        console.log("Error deleting the network", error, tableName)
    } finally { 
        res.sendStatus(200)
        con.release() }
}) 

//? <----- SSH FUNCTIONS ----->

webSocketServer.on('request', function(req) {
    if (req.resource === '/ssh') {
     //   const connection = req.accept(null, req.origin);
        let sshClient;

        clientConn.on('message', async function(message) {
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

                sshClient.on('error', err => clientConn.sendUTF(`\x1b[31mSSH Error: ${err.message}\x1b[0m\r\n`));
            } else if (data.cmd && sshClient) {
                // handled by shell listener
            }
        });

        clientConn.on('close', () => { if (sshClient) sshClient.end(); });
    } else {
       // req.reject();
    }
});

//? <------ UTILITY FUNCTIONS ------>

//* Connect to database (Now returns a connection from the pool)
async function getDatabaseConnection() {
    return pool.getConnection()
}

function getDate() {
    var now = new Date();
    var dd = String(now.getDate()).padStart(2, '0');
    var mm = String(now.getMonth() + 1).padStart(2, '0');
    var h = String(now.getHours())
    var m = String(now.getMinutes())
    var s = String(now.getSeconds())
    var yyyy = String(now.getFullYear())

    now = mm + '/' + dd + '/' + yyyy + ' at ' + h + ':' + m + ':' + s;

    return String(now);
}

//* wait 
function wait(ms) {
    return new Promise((resolve) => {
    setTimeout(resolve, ms)
})
}
//* Convert IP (i.e: 192.168.1.0/24) to 192_168_1_0_24
function convertIPtoTableName(IP) {
    if(IP == 0) return IP
    IP = IP.replace(/[.\/]/g, '_')
    return IP
}
//* Self explanatory
async function createNetworkTableIfNotExists(tableName, con) {
    try {
        const createTable = `
        CREATE TABLE IF NOT EXISTS ${tableName} (
            id INT AUTO_INCREMENT PRIMARY KEY,
            network_ip VARCHAR(45) NOT NULL,
            host_ip VARCHAR(45) NOT NULL,
            host_name VARCHAR(24) NOT NULL DEFAULT "unknown",
            host_os VARCHAR(24) NOT NULL DEFAULT "unknown",
            last_ping VARCHAR(32) NOT NULL DEFAULT "00:00:00",
            isAlive BOOLEAN DEFAULT FALSE,
            openPorts VARCHAR(2048) DEFAULT "none",
            UNIQUE unique_host_ip (host_ip)
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci
        `
        await con.query(createTable) 
    } catch (error) {
        console.error(`Error creating table ${tableName}:`, error)
        throw error; 
    }
}