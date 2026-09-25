# blind-push-gateway-cli

> **POC** - This is a proof-of-concept still. Breaking changes possible till the V1 release.

CLI to run the blind-push-gateway service. It listens on Hyperswarm, accepts `forward-push` RPC requests, and forwards them through Firebase Cloud Messaging.

Uses [blind-push-gateway](https://github.com/holepunchto/blind-push-gateway) under the hood.

## Install

```sh
npm install -g blind-push-gateway-cli
```

## Usage

```sh
blind-push-gateway run [options]
```

Create a config file at `~/.blind-push-gateway/config.json`:

```json
{
  "certPath": "./service-account.json",
  "notification": {
    "title": "Keet",
    "body": "✉️"
  },
  "apnsTopic": "io.keet.app"
}
```

Then run:

```sh
blind-push-gateway run
```

The service logs its public key on startup. Clients can connect to that swarm key and send `forward-push` RPC requests.

## Config

- `certPath`: path to a Firebase service account JSON file, relative to the config file. Required unless `--dry-run` is set.
- `notification`: default notification payload shown to users.
- `apnsTopic`: APNS topic, defaults to `io.keet.app`.

Example config for dry-run / local testing:

```json
{
  "notification": {
    "title": "Keet",
    "body": "✉️"
  },
  "apnsTopic": "io.keet.app"
}
```

```sh
blind-push-gateway run --dry-run --bootstrap '[{"host":"127.0.0.1","port":49737}]'
```

## CLI Options

- `--config|-c [path]`: config path, defaults to `~/.blind-push-gateway/config.json`
- `--storage|-s [path]`: storage path, defaults to `~/.blind-push-gateway/storage`
- `--dry-run`: dry-run mode without Firebase; log push payloads instead of sending them
- `--bootstrap [bootstrap]`: JSON array of HyperDHT bootstrap nodes. Use this to join a testnet or a custom DHT network
- `--trusted-peer|-t [trusted-peer]`: public key of a trusted peer. Can be specified multiple times
- `--dangerously-enable-inspector`: enable remote process inspection for trusted peers. Disabled by default
- `--scraper-public-key [scraper-public-key]`: public key of a dht-prometheus scraper. Can be hex or z32.
- `--scraper-secret [scraper-secret]`: secret of the dht-prometheus scraper. Can be hex or z32.
- `--scraper-alias [scraper-alias]`: optional alias with which to register to the scraper

## How It Works

1. The operator starts the gateway with Firebase service account credentials (or with `--dry-run`).
2. The gateway listens on Hyperswarm and accepts RPC connections through `protomux-rpc-router`.
3. A client sends a `forward-push` request encoded with `blind-push/encodings`.
4. The gateway encodes the request, derives Android/APNS fields, and forwards the message through the configured push service.
