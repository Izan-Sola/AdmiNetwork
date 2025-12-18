export { insertLog, displayLog }

    let device_logs = []

    var example_log = { 
                    IP: "192.168.100.10",
                    action: "sft", //or sftp, telnet, ssh
                    type: "error", //or warning, error, info
                    message: "Ping timedout at (time,date)",
                    timestamp: "None"
    }
    device_logs.push(example_log)
    var example_log = { 
                    IP: "192.168.100.15",
                    action: "telnet", 
                    type: "info", 
                    message: "Ping timedout at (time,date)",
                    timestamp: "None"
    }
    device_logs.push(example_log)

function insertLog(IP, action, type, message) {

    var timestamp = getDate()
    var new_log = {
        IP: IP,
        action: action,
        type: type,
        message: message,
        timestamp: timestamp
    }
    device_logs.push(new_log)
    console.log(new_log)

    fetch('/updateLog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ log: new_log })
    })
        // .then(res => res.json())
        // .then(data => {
        //     console.log("Successfully updated logs!")
        // })
}
//Display all logs. Optionally accepts filter options
function displayLog({ IP = null, type = "all", action = "all" } = {}) {
    fetch('/retrieveLog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empty: "" })
    })
    .then(res => res.json())
    .then(data => {
        const logsToDisplay = data.tempLogs.filter(log => {
            if (IP !== null && log.IP !== IP) return false;
            if (type !== "all" && log.type !== type) return false;
            if (action !== "all" && log.action !== type) return false;
            return true;
        });
        console.log(logsToDisplay);
    });
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
window.insertLog = insertLog;
window.displayLog = displayLog;