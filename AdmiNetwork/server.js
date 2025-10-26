const mysql = require('mysql2/promise')
const bodyParser = require("body-parser")
const ssh = require("ssh2")
const express = require('express')
const cors = require('cors')
const app = express()
const server = require('http').Server(app)
const WebSocketServer = require("websocket").server
const os = require('os')
const ip = require('ip')
const evilscan = require('evilscan')
const nmap = require('node-nmap')
nmap.nmapLocation = "/usr/bin/nmap"

// Initialize Database Connection Pool
const pool = mysql.createPool({
    host: "localhost",
    user: "root",
    password: "",
    port: 3306,
    database: "netscan",
    waitForConnections: true,
    connectionLimit: 15, // Increased connection limit slightly for parallel operations
    queueLimit: 0
})

app.set('port', 3000)
app.use(cors())
app.use(bodyParser.json())
app.use(express.json())
app.use(express.static('public'))
const NetWorkScanner = require('network-scanner-js')
const netScan = new NetWorkScanner()
// Increased listeners for concurrent Nmap scans
require('events').EventEmitter.defaultMaxListeners = 50 
const networkInfo = require('network-info')

//? <------ WEBSOCKET ------>
const webSocketServer = new WebSocketServer({
    httpServer: server,
    autoAcceptConnections: false 
})

webSocketServer.on("request", function (req) {
    if (req.origin === 'https://monthly-devoted-pug.ngrok-free.app') {
        const connection = req.accept(null, req.origin)
        connection.on("close", function () {
                    console.log("Server closed")
        })
    } else {
        req.reject()
    }
})

server.listen(3000, '192.168.18.48', () => {
    console.log('Server started on 192.168.18.48:3000')
})



//? <------ NETWORK FUNCTIONS ------->

//* Endpoint for scanning every available network if possible
app.post('/getAllNetworks', async (req, res) => {
    // 1. AWAIT getNetworksInfo, which starts all Nmap scans concurrently and WAITS for all of them to finish.
    const networks = await getNetworksInfo({
        scanHosts: true
    })

    // 2. Await saving the network metadata concurrently.
    const savePromises = networks.map(network => saveNetworkInfo(network))
    await Promise.allSettled(savePromises) 

    // 3. Respond after all work is done.
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
    
    // CRITICAL: Wait for ALL concurrent Nmap scans and their database writes to complete.
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
    // This function now inherently waits for the scan and host saves
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
            console.log(`NMAP found ${data.length} hosts in ${subnet}. Starting concurrent saves...`)
            
            // CRITICAL FIX: Run database saves CONCURRENTLY (in parallel)
            const savePromises = data.map(hostData =>
                saveHostsInfo(subnet, hostData).catch(err => {
                    console.error(`Error saving host ${hostData.ip}:`, err.message)
                    return { status: 'rejected', reason: err } // Return a rejected status for allSettled
                })
            )
            
            // Wait for ALL hosts to be saved before resolving the Nmap scan promise
            Promise.allSettled(savePromises)
                .then(() => {
                    console.log(`All host save operations completed for ${subnet}`)
                    resolve({ subnet: subnet, hosts: data.length }) 
                })
                .catch(err => {
                    // This catch block handles internal Promise.allSettled errors, rare but safe
                    console.error(`Error during concurrent host saving coordination for ${subnet}:`, err)
                    resolve({ subnet: subnet, hosts: data.length, error: 'Internal save coordination failure' })
                })
        })
        
        scan.once('error', (err) => {
            console.error(`NMAP scan error for ${subnet}:`, err)
            reject(err) // Reject the promise on scan error
        })
        scan.startScan()
    })
}

//? <----- DATABASE FUNCTIONS (Using Pool) ----->

//* Create a new table for the network if it doesnt exist, and insert the host
async function saveHostsInfo(network, hostData) {

    const tableName = convertIPtoTableName(network)
    const con = await getDatabaseConnection() // Use pool
    
    try {
        await createNetworkTableIfNotExists(tableName, con) 

        const insertHost = `INSERT IGNORE INTO ${tableName} SET network_ip = ?, host_ip = ?, host_name = ?, host_os = ?`
        await con.query(insertHost, [
            network, 
            hostData.ip, 
            hostData.hostname,
            hostData.osNmap
        ])

        return { message: 'Host saved successfully', host: hostData.ip }

    } catch (err) {
        console.error('Database error for host', hostData.ip, ':', err)
        throw err
    } finally {
        if (con) con.release() // CRITICAL: Release connection back to pool
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
            if (con) con.release() // CRITICAL: Release connection back to pool
        }

}

app.post('/loadNetworkData', async (req, res) => {
  const [networkData] = await loadNetworkData(req.body.network)
  res.json({ networkData })
})

//* Retrieve the data of all the networks, or only the hosts of a target network
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
            return [] // Return empty array on error
        } finally {
            if (con) con.release() // CRITICAL: Release connection back to pool
        }
}


//? <------ UTILITY FUNCTIONS ------>

//* Connect to database (Now returns a connection from the pool)
async function getDatabaseConnection() {
    return pool.getConnection()
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
//* Self explanatory - Requires a connection object to be passed
async function createNetworkTableIfNotExists(tableName, con) {
    try {
        const createTable = `
        CREATE TABLE IF NOT EXISTS ${tableName} (
            id INT AUTO_INCREMENT PRIMARY KEY,
            network_ip VARCHAR(45) NOT NULL,
            host_ip VARCHAR(45) NOT NULL,
            host_name VARCHAR(24) NOT NULL DEFAULT "unknown",
            host_os VARCHAR(24) NOT NULL DEFAULT "unknown",
            last_ping DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE unique_host_ip (host_ip)
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci
        `
        await con.query(createTable) 
    } catch (error) {
        console.error(`Error creating table ${tableName}:`, error)
        throw error; 
    }
}