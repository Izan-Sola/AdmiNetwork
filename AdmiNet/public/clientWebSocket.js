

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
           console.log(message)
}
function onOpen() {
    console.log("THIS HSHIT HAS WORKED UWU")
}
function onClose(reason) {
    console.log('Connection closed' + reason)
    
}

function onError(error) {
    console.log('Error: ' + error.data)
}

function doSend(msg, type, user) {
    const message = JSON.stringify({ msg: msg, type: type, user: user });
    wsocket.send(message);
}

window.addEventListener('load', function () {
    openConnection()
 
})
