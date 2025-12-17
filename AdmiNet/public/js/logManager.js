export { insertDeviceLog, displayDeviceLog }

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

function insertDeviceLog(IP, action, type, message) {

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
}
//Display all logs. Optionally accepts IP and type arguments to filter by one or both.
function displayDeviceLog(IP = 0, type = "all") {

        var logsToDisplay = device_logs 

        if(type != "all") {
            if(IP != 0) logsToDisplay = device_logs.filter(log => (log.IP == IP && log.type == type))
            else logsToDisplay = device_logs.filter(log => (log.type == type))
        }
        else {
            if(IP != 0) logsToDisplay = device_logs.filter(log => (log.IP == IP))            
            else logsToDisplay = device_logs
        }
        console.log(logsToDisplay)
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
window.insertDeviceLog = insertDeviceLog;
window.displayDeviceLog = displayDeviceLog;