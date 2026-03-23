import { io } from 'socket.io-client'

const base = process.env.BASE_URL || 'http://localhost:3001'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function post(path, body, token) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const r = await fetch(`${base}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body || {}),
  })
  const text = await r.text()
  return { status: r.status, text }
}

async function getJson(path, token) {
  const headers = {}
  if (token) headers.authorization = `Bearer ${token}`
  const r = await fetch(`${base}${path}`, { headers })
  return { status: r.status, json: await r.json() }
}

const email = `e2e_${Date.now()}@example.com`
const password = 'Passw0rd!'
const name = 'E2E'

await post('/api/auth/register', { name, email, password })
const login = await post('/api/auth/login', { email, password })
if (login.status !== 200) {
  console.error('login_failed', login.status, login.text)
  process.exit(1)
}

const token = JSON.parse(login.text).token
const profile = await getJson('/api/auth/profile', token)
const clientId = profile.json._id

await post('/api/whatsapp/connect', {}, token)
const instance = `client_${clientId}`

const socket = io(base, { transports: ['websocket', 'polling'] })
await new Promise((resolve, reject) => {
  socket.on('connect', resolve)
  socket.on('connect_error', reject)
})
socket.emit('join', clientId)

const got = new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('timeout_new_message')), 6000)
  socket.on('new_message', (p) => {
    clearTimeout(t)
    resolve(p)
  })
})

await sleep(200)
await fetch(`${base}/api/webhooks/evolution`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    event: 'MESSAGES_UPSERT',
    instance,
    data: {
      messages: [
        {
          key: {
            remoteJid: '5511000000000@s.whatsapp.net',
            fromMe: false,
            id: `e2e_${Date.now()}`,
          },
          pushName: 'E2E',
          message: { conversation: 'ping' },
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
      ],
    },
  }),
})

const payload = await got
console.log('received', Boolean(payload?.conversation?._id), Boolean(payload?.message?._id))

const conversations = await getJson(`/api/conversations?_t=${Date.now()}`, token)
console.log('conversations_status', conversations.status)
console.log('conversations_count', Array.isArray(conversations.json) ? conversations.json.length : 'not-array')

socket.disconnect()
