

function openConnection() {
   wsocket = new WebSocket('ws://adminetwork.duckdns.org');
    wsocket.onopen = function (event) {
        onOpen(event)
    }; wsocket.onclose = function (event) {
        onClose(event)
    }; wsocket.onmessage = function (event) {
        onMessage(event)
    }; wsocket.onerror = function (event) {
        onError(event)
    };

}
function onMessage(msgc){
        message = JSON.parse(msgc.data)
        console.log(message.network)
        
    switch (message.type) {
        case 'scanComplete': $('#scan-completed').html('Completed scan for: '+message.network); break;
        case 'foundNetwork': $('#scan-interfaces').append('<b>'+message.network+'&emsp;</b>'); break;
    }
}
function onOpen() {
    console.log("This worked")
}
function onClose(reason) {
    console.log('Connection closed' + reason)   
}
function onError(error) {
    console.log('Error: ' + error.data)
}
function doSend(msg, type) {
    const message = JSON.stringify({ msg: msg, type: type });
    wsocket.send(message);
}
window.addEventListener('load', function () {
    openConnection()
})
