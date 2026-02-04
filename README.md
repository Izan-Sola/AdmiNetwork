# AdmiNetwork (WIP) (proyecto grado superior)

Administrate the available networks with this Electron web applicaton.

Scan all the available networks and its hosts, servers, virtual machines, retrieving advanced info like the operative system, open ports, active services...
Connect to any available device remotely if possible with SSH, SFTP or telnet.
Logs information about each host like the last ping, last connections, active time, services...

## Preview

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/3b1109b0-55db-4e66-85d0-6dabface2e64" />

<br>



# Documentation:

## Network scanning:

- Making use of the node-nmap library and a local installation of nmap in the machine, AdmiNetwork scans all the available networks and retrieves detailed information such as: the IP address, the operative system, open ports...
- Each network can be viewed by clicking on it in the left panel. All of the devices are organized in cards, displaying information about them and the options to edit them, view their details, and delete them.


## Remote connection:

AdmiNetwork provides 3 different ways of connecting remotely to a device:

- Via SSH, using libraries such as Ssh-2 for the remote connection, xTerm for the simulated terminal and Keytar to store the keys safely in the credential manager of your operative system allowing easy and secure use of them. 
- Via SFTP, allowing you to browse the remote directory, upload and download files.
- Via Telnet, for devices such as routers that might not support SSH.


## Logging:

- AdmiNetwork implements a logging system to save a record of relevant activity such as remote connections; saving the user that performed the action, the device he connected to, and each command that was performed. 
- Each card displays the ping response time and the last successful ping that was performed on the device, letting you know for how long it has been inactive if down.


## Data storage:

- AdmiNetwork uses a JSON file for storing data related to the networks and their hosts, and another JSON file for storing all the logs, ensuring instant load times when retrieving big chunks of data.














## TODO

- Rename some functions names to be less confusing
- Telnet connection. Polish ssh and sftp, implement keytar.
- Logs for each device and network (Perchance, implement AI so you can ask it to provide you with specific data in the logs)
- Implement Electron for the desktop app version
- Users, permissions...
- Probably some more stuff that I cant think about of the top of my head rn...
