export { insertLog, displayLog }

function insertLog(IP, action, type, message) {
    const timestamp = getDate();
    const new_log = { IP, action, type, message, timestamp };

    console.log(new_log);

    fetch('/updateLog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ log: new_log })
    }).catch(err => console.error('Failed to save log:', err));
}

function displayLog({ IP = null, type = "all", action = "all" } = {}) {
    fetch('/retrieveLog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
    })
    .then(res => res.json())
    .then(data => {
        const logsToDisplay = (data.tempLogs || []).filter(log => {
            if (IP !== null && log.IP !== IP) return false;
            if (type !== "all" && log.type !== type) return false;
            if (action !== "all" && log.action !== action) return false;
            return true;
        });
        console.log(logsToDisplay);
        return logsToDisplay;
    });
}

function getDate() {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const h  = String(now.getHours()).padStart(2, '0');
    const m  = String(now.getMinutes()).padStart(2, '0');
    const s  = String(now.getSeconds()).padStart(2, '0');
    const yyyy = now.getFullYear();
    return `${mm}/${dd}/${yyyy} at ${h}:${m}:${s}`;
}

window.insertLog = insertLog;
window.displayLog = displayLog;