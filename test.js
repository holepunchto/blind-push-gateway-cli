const test = require('brittle')
const { spawn } = require('child_process')
const fs = require('fs').promises
const path = require('path')
const process = require('process')
const b4a = require('b4a')
const cenc = require('compact-encoding')
const createTestnet = require('hyperdht/testnet')
const HyperDHT = require('hyperdht')
const IdEnc = require('hypercore-id-encoding')
const NewlineDecoder = require('newline-decoder')
const ProtomuxRPC = require('protomux-rpc')
const { isBare } = require('which-runtime')

const blindPush = require('blind-push')
const { ForwardPushRequest } = require('blind-push/encodings')

const DEBUG = false
const EXECUTABLE = path.join(__dirname, isBare ? 'bin-bare.js' : 'bin.js')

test('bin', async (t) => {
  const testnet = await createTestnet()
  t.teardown(() => testnet.destroy(), { order: 5000 })
  const { bootstrap } = testnet

  const dir = await t.tmp()
  const cliStorageDir = path.join(dir, 'cli-storage')
  await fs.mkdir(cliStorageDir)

  const configLoc = path.join(dir, 'config.json')
  await fs.writeFile(
    configLoc,
    JSON.stringify({
      dryRun: true,
      notification: {
        title: 'Keet',
        body: '✉️'
      },
      apnsTopic: 'io.keet.app',
      bootstrap
    })
  )

  const tRun = t.test('CLI starts')
  tRun.plan(1)

  const proc = spawn(process.execPath, [
    EXECUTABLE,
    'run',
    '--config',
    configLoc,
    '--storage',
    cliStorageDir
  ])

  // To avoid zombie processes in case there's an error
  process.on('exit', () => {
    proc.kill('SIGKILL')
  })
  t.teardown(() => {
    if (proc.exitCode === null) proc.kill('SIGKILL')
  })

  proc.stderr.on('data', (d) => {
    console.error(d.toString())
    t.fail('There should be no stderr')
  })

  let publicKey = null
  let pushedMessage = null
  const tPush = t.test('dry-run push')
  tPush.plan(1)

  const stdoutDec = new NewlineDecoder('utf-8')
  proc.stdout.on('data', (d) => {
    if (DEBUG) console.log(d.toString())

    for (const line of stdoutDec.push(d)) {
      let parsed = null
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }

      const msg = parsed.msg || ''
      if (msg.includes('Public key:') && !publicKey) {
        tRun.pass('public key is printed')
        publicKey = msg.split('Public key: ')[1]
      }

      if (msg === 'dry-run push' && parsed.message && !pushedMessage) {
        tPush.pass('push was logged')
        pushedMessage = parsed.message
      }
    }
  })

  await tRun
  t.ok(publicKey, 'got public key')

  const rpc = await setupClient(t, bootstrap, IdEnc.decode(publicKey))

  const req = {
    payload: {
      payload: b4a.from('blind-push'),
      discoveryKey: b4a.alloc(32, 0x42),
      version: 0,
      extra: null
    }
  }

  await rpc.request('forward-push', req, {
    requestEncoding: ForwardPushRequest,
    responseEncoding: cenc.none
  })

  await tPush

  const encodedPayload = b4a.toString(blindPush.encode(req.payload), 'base64')
  t.is(pushedMessage.topic, b4a.toString(req.payload.discoveryKey, 'hex'))
  t.is(pushedMessage.android.priority, 'high')
  t.is(pushedMessage.android.data.title, 'Keet')
  t.is(pushedMessage.android.data.body, '✉️')
  t.is(pushedMessage.android.data.payload, encodedPayload)
  t.is(pushedMessage.apns.headers['apns-topic'], 'io.keet.app')
  t.is(pushedMessage.apns.payload.aps.threadId, b4a.toString(req.payload.discoveryKey, 'base64'))
  t.is(pushedMessage.apns.payload.payload, encodedPayload)

  const tShutdown = t.test('Shutdown')
  tShutdown.plan(1)
  proc.on('exit', () => tShutdown.pass('CLI process shut down cleanly'))
  proc.kill('SIGINT')
  await tShutdown
})

async function setupClient(t, bootstrap, serverPublicKey) {
  const dht = new HyperDHT({ bootstrap })
  t.teardown(() => dht.destroy(), { order: 4000 })

  const stream = dht.connect(serverPublicKey)
  stream.on('error', () => {})
  await stream.opened

  const rpc = new ProtomuxRPC(stream, {
    id: serverPublicKey,
    valueEncoding: null
  })
  await rpc.fullyOpened()

  return rpc
}
