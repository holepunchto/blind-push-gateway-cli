const NewlineDecoder = require('newline-decoder')

exports.waitForOutput = async (proc, text, timeout = 30000) => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for "${text}"`))
    }, timeout)

    const stdoutDec = new NewlineDecoder('utf-8')
    proc.stdout.on('data', (d) => {
      for (const line of stdoutDec.push(d)) {
        if (line.includes(text)) {
          clearTimeout(timer)
          resolve(line)
        }
      }
    })
  })
}
