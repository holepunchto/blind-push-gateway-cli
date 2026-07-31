const ReadyResource = require('ready-resource')
const { cert, deleteApp, initializeApp } = require('firebase-admin/app')
const { getMessaging } = require('firebase-admin/messaging')

class FcmPushService extends ReadyResource {
  /**
   * @param {string} certPath
   */
  constructor(certPath) {
    super()

    this.certPath = certPath
    this.app = null
    this.messaging = null
  }

  _open() {
    this.app = initializeApp({
      credential: cert(this.certPath)
    })

    this.messaging = getMessaging(this.app)
  }

  async _close() {
    if (this.messaging) this.messaging = null

    if (this.app) {
      const app = this.app
      this.app = null
      await deleteApp(app)
    }
  }

  /**
   * @param {import('..').ExternalPushMessage} message
   * @returns {Promise<unknown>}
   */
  async send(message) {
    if (!this.opened) await this.ready()
    return await this.messaging.send(message)
  }
}

module.exports = FcmPushService
