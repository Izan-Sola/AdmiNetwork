// const jsdom = require('jsdom')
// const dom = new jsdom.JSDOM("")
// const $ = require('jquery')(dom.window)
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

app.set('port', 3000)
app.use(cors())
app.use(bodyParser.json())
app.use(express.json())
app.use(express.static('public'))
const NetWorkScanner = require('network-scanner-js')
const netScan = new NetWorkScanner()
require('events').EventEmitter.defaultMaxListeners = 25
const networkInfo = require('network-info')

//? <----- NETWORK SCAN CONFIG ----->
// const config = {
//   repeat: 4,
//   size: 56,
//   timeout: 1
// }


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
    console.log('Server started')
})



//? <------ NETWORK FUNCTIONS ------->

//* Endpoint for scanning every available network if possible
app.post('/getAllNetworks', async (req, res) => {
    const networks = await getNetworksInfo({
        scanHosts: true
    })
    networks.forEach( network => {
        saveNetworkInfo(network)
    })
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

    for (const interfaceName in interfaces) {
        for (const iface of interfaces[interfaceName]) {
            // Only consider IPv4 non-internal interfaces
            if (iface.family === 'IPv4' && !iface.internal) {
                const subnet = ip.subnet(iface.address, iface.netmask)
                const interfaceCIDR = `${subnet.networkAddress}/${subnet.subnetMaskLength}`

                // If looking for specific CIDR, check if this interface matches the host IP
                if (targetCIDR) {
                    const [targetHostIP, targetPrefix] = targetCIDR.split('/')
               
                    // Check if this interface has the target host IP
                    if (iface.address === targetHostIP) {
                        // Convert host IP and mask
                        const networkSubnet = ip.cidrSubnet(targetCIDR)
                        const networkCIDR = `${networkSubnet.networkAddress}/${targetPrefix}`
                        
                        const networkInfo = {
                            interface: interfaceName,
                            ip: iface.address,          
                            netmask: iface.netmask,      
                            cidr: networkCIDR,           
                            hostCIDR: targetCIDR        
                        }                
                        if (scanHosts) {
                            retrieveHostInfo(networkCIDR)
                        }
                        return [networkInfo]
                    }
                } else {             
                    const networkInfo = {
                        interface: interfaceName,
                        ip: iface.address,
                        netmask: iface.netmask,
                        cidr: interfaceCIDR
                    }
                    if (scanHosts) {
                        retrieveHostInfo(interfaceCIDR)
                    }
                    networks.push(networkInfo)
                }
           }
        }
    }
    return targetCIDR ? null : networks
}

//* Endpoint for scanning the specified network and insert each active host into the database
app.post('/scanNetwork', async (req, res) => {

    const networks = await getNetworksInfo({
        targetCIDR: req.body.subnet,
        scanHosts: true
    })
    await saveNetworkInfo(networks[0])
    res.json({ networks })
})



//* Get advanced info of the host
async function retrieveHostInfo(subnet) {
    return new Promise((resolve, reject) => {
        console.log(`Starting NMAP scan for subnet: ${subnet}`)
        
        const scan = new nmap.NmapScan(subnet, "-O")
        
        scan.once('complete', async (data) => {
            try {
                console.log(`NMAP found ${data.length} hosts`)
            
                for (const hostData of data) {
                    try {
                        await saveHostsInfo(subnet, hostData)
                        console.log(`Saved host ${hostData.ip} to database`)
                        
                    } catch (error) {
                        console.error(`Error saving host ${hostData.ip}:`, error)
                    }  }          
                console.log('All hosts processed successfully')
                resolve(data)
                
            } catch (error) {
                reject(error)
            }
        })
        scan.once('error', reject)
        scan.startScan()
    })
}

//? <----- DATABASE FUNCTIONS ----->

//* Create a new table for the network if it doesnt exist, and insert the host
async function saveHostsInfo(network, hostData) {

    const tableName = convertIPtoTableName(network)
    const con = await connectToDatabase()
    
    try {
        await createNetworkTableIfNotExists(tableName)

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
        await con.end()
    }
}

//* Upload the network infromation to the database
async function saveNetworkInfo(network) {

    const con = await connectToDatabase()

        try {
            const insertNetwork = `INSERT IGNORE INTO networks_data SET cidr = ?, interface = ?, netmask = ?`
            await con.query(insertNetwork, [ network.cidr, network.interface, network.netmask ])
            console.log("Network data inserted succesfully")
        } catch (err) {
            console.error('Database error when inserting networkdata', network, err)
        } finally {
            await con.end()
        }

}

//! TODO: REMOVE THIS ENDPOINT AND REFACTORIZE /loadNetworkData

app.post('/getHostsFromNetwork', async (req, res) =>{

    const con = await connectToDatabase()
    try {
        const subnet = req.body.subnet
        console.log(subnet)
        const tableName = convertIPtoTableName(subnet)
        await createNetworkTableIfNotExists(tableName)
        const getHosts = `SELECT * FROM ${tableName}`
        const hosts = await con.execute(getHosts)
        res.json({hosts: hosts[0]})
    } catch (error) {
        console.error('Error trying to insert host', error)
        return { error: 'ERROR'}
    } finally {
    await con.end()
    }

})
//! ---------------------------------------------------------------

app.post('/loadNetworkData', async (req, res) => {
  networkData = await loadNetworkData(req.body.network)
  res.json({ networkData })
})

//* Retrieve the data of all the networks, or only the hosts of a target network
async function loadNetworkData(targetCIDR) {

    const tableName = convertIPtoTableName(targetCIDR)
    const con = await connectToDatabase()

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
        } finally {
            await con.end()
        }
}


//? <------ UTILITY FUNCTIONS ------>

//* Connect to database
async function connectToDatabase() {
    con = await mysql.createConnection({
        host: "localhost",
        user: "root",
        password: "",
        database: "netscan"
    })
    return con
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
async function createNetworkTableIfNotExists(tableName) {
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
    con.query(createTable)
}
