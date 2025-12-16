export { insertLog, displayLog }
    let ram_logs = []
    var example_log = { 
                    IP: "192.168.100.10",
                    action: "ping", //or sftp, telnet, ssh
                    type: "success", //or warning, success
                    message: "Ping timedout at (time,date)",
                    timestamp: "None"
    }
    ram_logs.push(example_log)
    var example_log = { 
                    IP: "192.168.100.15",
                    action: "ping", //or sftp, telnet, ssh
                    type: "error", //or warning, success
                    message: "Ping timedout at (time,date)",
                    timestamp: "None"
    }
    ram_logs.push(example_log)
function insertLog(IP, action, type, message) {

    var timestamp = getDate()
    var new_log = {
        IP: IP,
        action: action,
        type: type,
        message: message,
        timestamp: timestamp
    }
    ram_logs.push(new_log)
}

function displayLog(IP, type) {

        var logsToDisplay = ram_logs;

        if(type != "all") logsToDisplay = ram_logs.filter(log => (log.IP == IP && log.type == type))
        else logsToDisplay = ram_logs.filter(log => log.IP == IP)

        console.log(logsToDisplay)
       // allHostsToPing = allHostsToPing.filter(h => h.host_ip !== hostIP);

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