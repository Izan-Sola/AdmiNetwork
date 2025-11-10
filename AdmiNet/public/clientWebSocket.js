

function openConnection() {
    wsocket = new WebSocket('ws://localhost:3001/')
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

           msgdata = JSON.parse(msgc.data)
           console.log()
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
