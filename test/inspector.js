const test = require('brittle')
const { spawn } = require('child_process')
const { once } = require('events')
const fs = require('fs/promises')
const path = require('path')
const process = require('process')
const createTestnet = require('hyperdht/testnet')
const NewlineDecoder = require('newline-decoder')

const EXECUTABLE = path.join(__dirname, '..', 'bin.js')
const CONFIG = path.join(__dirname, 'config.test.json')
const INSPECTOR_EXECUTABLE = require.resolve('hyperdht-inspector-cli/bin.js')

test('inspector allows trusted peers and rejects untrusted peers', async (t) => {
  const testnet = await createTestnet(10)
  t.teardown(() => testnet.destroy(), { order: 5000 })
  const { bootstrap } = testnet

  const dir = await t.tmp()
  const cliStorageDir = path.join(dir, 'cli-storage')
  const trustedStorageDir = path.join(dir, 'trusted-inspector')
  await fs.mkdir(cliStorageDir)

  const identity = await runInspectorCli(t, 'identity', '--storage', trustedStorageDir)
  t.is(identity.exitCode, 0, `inspector CLI prints its identity: ${identity.stderr}`)
  const trustedPublicKey = identity.stdout.trim()

  const proc = spawn(process.execPath, [
    EXECUTABLE,
    'run',
    '--config',
    CONFIG,
    '--storage',
    cliStorageDir,
    '--dry-run',
    '--bootstrap',
    JSON.stringify(bootstrap),
    '--trusted-peer',
    trustedPublicKey,
    '--dangerously-enable-inspector'
  ])

  process.on('exit', () => {
    proc.kill('SIGKILL')
  })
  t.teardown(() => {
    if (proc.exitCode === null) proc.kill('SIGKILL')
  })

  proc.stderr.on('data', (data) => {
    console.error(data.toString())
    t.fail('There should be no stderr')
  })

  const publicKey = JSON.parse(await waitForOutput(proc, 'Public key:')).msg.split(
    'Public key: '
  )[1]
  const profilePath = path.join(dir, 'profile.cpuprofile')

  const trusted = await runInspectorCli(
    t,
    'cpu-profile',
    publicKey,
    '--out',
    profilePath,
    '--duration',
    '100',
    '--storage',
    trustedStorageDir,
    '--bootstrap',
    JSON.stringify(bootstrap)
  )
  t.is(trusted.exitCode, 0, `trusted peer can use the inspector: ${trusted.stderr}`)

  const profile = JSON.parse(await fs.readFile(profilePath, 'utf8'))
  t.ok(profile.nodes.length > 0, 'inspector writes a CPU profile')

  const heapdumpPath = path.join(dir, 'profile.heapsnapshot')
  const heapdump = await runInspectorCli(
    t,
    'heapdump',
    publicKey,
    '--out',
    heapdumpPath,
    '--storage',
    trustedStorageDir,
    '--bootstrap',
    JSON.stringify(bootstrap)
  )
  t.is(heapdump.exitCode, 0, `trusted peer can capture a heapdump: ${heapdump.stderr}`)

  const heapSnapshot = JSON.parse(await fs.readFile(heapdumpPath, 'utf8'))
  t.ok(heapSnapshot.nodes.length > 0, 'inspector writes a heap snapshot')

  const untrusted = await runInspectorCli(
    t,
    'cpu-profile',
    publicKey,
    '--out',
    path.join(dir, 'untrusted.cpuprofile'),
    '--duration',
    '100',
    '--storage',
    path.join(dir, 'untrusted-inspector'),
    '--bootstrap',
    JSON.stringify(bootstrap)
  )
  t.not(untrusted.exitCode, 0, 'untrusted peer cannot use the inspector')
})

async function waitForOutput(proc, text, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for "${text}"`))
    }, timeout)

    const stdoutDec = new NewlineDecoder('utf-8')
    proc.stdout.on('data', (data) => {
      for (const line of stdoutDec.push(data)) {
        if (line.includes(text)) {
          clearTimeout(timer)
          resolve(line)
        }
      }
    })
  })
}

async function runInspectorCli(t, ...args) {
  const proc = spawn(process.execPath, [INSPECTOR_EXECUTABLE, ...args], {
    stdio: 'overlapped'
  })

  t.teardown(async () => {
    if (proc.exitCode === null && proc.signalCode === null) {
      const killed = once(proc, 'exit')
      proc.kill('SIGKILL')
      await killed
    }
  })

  let stdout = ''
  let stderr = ''

  proc.stdout.on('data', (data) => {
    stdout += data.toString()
  })
  proc.stderr.on('data', (data) => {
    stderr += data.toString()
  })

  const [exitCode] = await once(proc, 'close')

  return { exitCode, stdout, stderr }
}
