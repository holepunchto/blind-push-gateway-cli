#!/usr/bin/env node

const fs = require('fs').promises
const os = require('os')
const path = require('path')
const Corestore = require('corestore')
const HyperDHT = require('hyperdht')
const ProtomuxRPCRouter = require('protomux-rpc-router')
const IdEnc = require('hypercore-id-encoding')
const goodbye = require('graceful-goodbye')
const { command, flag } = require('paparam')
const pino = require('pino')
const Instrumentation = require('hyper-instrument')

const BlindPushGateway = require('blind-push-gateway')

const { version: ownVersion } = require('./package.json')

const FcmPushService = require('./lib/fcm')

const SERVICE_NAME = 'blind-push-gateway'
const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.blind-push-gateway', 'config.json')
const DEFAULT_STORAGE_PATH = path.join(os.homedir(), '.blind-push-gateway', 'storage')

const runCmd = command(
  'run',
  flag('--config|-c [path]', `config path, defaults to ${DEFAULT_CONFIG_PATH}`),
  flag('--storage|-s [path]', `storage path, defaults to ${DEFAULT_STORAGE_PATH}`),
  flag(
    '--scraper-public-key [scraper-public-key]',
    'Public key of a dht-prometheus scraper.  Can be hex or z32.'
  ),
  flag(
    '--scraper-secret [scraper-secret]',
    'Secret of the dht-prometheus scraper.  Can be hex or z32.'
  ),
  flag('--scraper-alias [scraper-alias]', '(optional) Alias with which to register to the scraper'),
  flag('--dry-run', 'Dry-run mode without Firebase'),
  flag('--bootstrap [bootstrap]', 'Bootstrap nodes for the DHT'),
  async function ({ flags }) {
    const logger = pino({ name: SERVICE_NAME })

    const configPath = path.resolve(flags.config || DEFAULT_CONFIG_PATH)
    logger.info(`Reading config from: ${configPath}`)
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'))

    if (!config.certPath && !flags.dryRun) {
      logger.error('Config requires a certPath')
      process.exit(1)
    }

    const storage = path.resolve(flags.storage || DEFAULT_STORAGE_PATH)
    logger.info(`Using storage: ${storage}`)

    const store = new Corestore(storage)
    const dht = new HyperDHT({
      keyPair: await store.createKeyPair('swarm-key'),
      ...(flags.bootstrap ? { bootstrap: JSON.parse(flags.bootstrap) } : {})
    })
    const router = new ProtomuxRPCRouter()

    let pushService
    if (flags.dryRun) {
      pushService = {
        ready: async () => {},
        close: async () => {},
        send: async (message) => {
          logger.info({ message }, 'dry-run push')
        }
      }
    } else {
      const certPath = path.resolve(path.dirname(configPath), config.certPath)
      logger.info(`Using Firebase credential: ${certPath}`)
      pushService = new FcmPushService(certPath)
    }

    const service = new BlindPushGateway(dht, router, pushService, {
      notification: config.notification,
      apnsTopic: config.apnsTopic
    })

    goodbye(async () => {
      logger.info('Shutting down blind-push-gateway service')
      await service.close()
      await pushService.close()
      await dht.destroy()
      await store.close()
    })

    if (flags.scraperPublicKey) {
      logger.info('Setting up instrumentation')

      const scraperPublicKey = IdEnc.decode(flags.scraperPublicKey)
      const scraperSecret = IdEnc.decode(flags.scraperSecret)

      let prometheusAlias = flags.scraperAlias
      if (prometheusAlias && prometheusAlias.length > 99) {
        throw new Error('The Prometheus alias must have length less than 100')
      }
      if (!prometheusAlias) {
        prometheusAlias =
          `blind-push-gateway-${IdEnc.normalize(dht.defaultKeyPair.publicKey)}`.slice(0, 99)
      }

      const instrumentation = new Instrumentation({
        dht,
        scraperPublicKey,
        prometheusAlias,
        scraperSecret,
        prometheusServiceName: SERVICE_NAME,
        version: ownVersion
      })

      service.registerMetrics(instrumentation.promClient)
      instrumentation.registerLogger(logger)
      await instrumentation.ready()

      goodbye(async () => {
        await instrumentation.close()
      })
    }

    logger.info('Starting blind-push-gateway service')
    await pushService.ready()
    await service.ready()

    logger.info(`Public key: ${IdEnc.normalize(service.publicKey)}`)
  }
)

const cmd = command('blind-push-gateway', runCmd)

cmd.parse()
