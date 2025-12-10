let username, password
let currentDir = '.'
async function connectSFTP() {
  username = document.getElementById('username').value.trim()
  password = document.getElementById('password').value.trim()
  document.getElementById('loginError').textContent = ''

  const res = await fetch('/api/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, dir: '.' })
  })

  const data = await res.json()
  console.log(data)
  
  if (!data.success) {
    document.getElementById('loginError').textContent = '❌ ' + data.error
    return
  }
  //* Store credentials AND initial file data
  sessionStorage.setItem('ssh_user', username)
  sessionStorage.setItem('ssh_pass', password)
  sessionStorage.setItem('initial_files', JSON.stringify(data.files))
  sessionStorage.setItem('initial_dir', '.')
  window.location.href = 'sftpbrowser.html'

}

async function loadDir(dir) {
  const res = await fetch('/api/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, dir })
  })
  const data = await res.json()
  if (!data.success) {
    alert('Error: ' + data.error)
    return
  }
  renderFiles(data.files, dir)
}

//*Display the files and relevant info 
function renderFiles(files, dir) {
  const fileTable = document.querySelector('#fileTable tbody')
  const pathDisplay = document.querySelector('#path')
  currentDir = dir
  pathDisplay.textContent = `Current directory: ${dir}`
  fileTable.innerHTML = ''

  if (dir !== '.') {
    const upDir = dir.split('/').slice(0, -1).join('/') || '.'
    const tr = document.createElement('tr')
    tr.innerHTML = `<td colspan="4" style="cursor:pointer">⬆️ Go up</td>`
    tr.onclick = () => loadDir(upDir)
    fileTable.appendChild(tr)
  }

  files.forEach(f => {
    const tr = document.createElement('tr')
    const name = document.createElement('td')
    const size = document.createElement('td')
    const mod = document.createElement('td')
    const act = document.createElement('td')

    name.textContent = f.name
    size.textContent = f.type === 'd' ? '-' : f.size
    mod.textContent = new Date(f.modifyTime).toLocaleString()

    if (f.type === 'd') {
      name.style.cursor = 'pointer'
      name.onclick = () => loadDir(`${dir}/${f.name}`)
      act.textContent = '📁'
    } else {
      const btn = document.createElement('button')
      btn.textContent = '⬇️'

      btn.onclick = async () => {
        const res = await fetch('/api/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username,
            password,
            filePath: `${dir}/${f.name}`
          })
        })
        if (res.ok) {
          const blob = await res.blob()
          const a = document.createElement('a')
          a.href = URL.createObjectURL(blob)
          a.download = f.name
          a.click()
        } else alert('Download failed')
      }
      act.appendChild(btn)
    }

    tr.append(name, size, mod, act)
    fileTable.appendChild(tr)
  })
}

async function uploadFile() {
  const fileInput = document.getElementById('file-input')
  const file = fileInput.files[0]
  if (!file) return alert('Please select a file.')
  const remoteDir = currentDir
  const formData = new FormData()
  formData.append('username', username)
  formData.append('password', password)
  formData.append('file', file)
  formData.append('remoteDir', remoteDir)
  const res = await fetch('/api/upload', {
    method: 'POST',
    body: formData
  })

  if (res.ok) {
    alert('Upload complete!')
    loadDir(remoteDir)
  } else alert('Upload failed')
}
