# Deploying MiniBald: HTTPS, NAS, backups

## Moving to a NAS

Everything the app owns is in the data folder. Moving is: stop, copy the folder, start.

1. On the PC: `docker compose down`. Stopping first lets SQLite fold its write-ahead log into `minis.db`.
2. Copy the repository folder (or at least `docker-compose.yml`, `Dockerfile`, `.env` and the sources) and the whole
   `data` folder to the NAS, for example to `/volume1/docker/mini-bald`.
3. On the NAS, edit `.env`:
   - `PUID` / `PGID`: the ids of the NAS user that owns the folder (run `id <user>` over SSH).
   - `DATA_PATH`: where the data folder is, if it is not next to `docker-compose.yml`.
   - `TZ`: your time zone. Streaks and "this month" follow it.
4. Make sure that user can write the data folder: `chown -R <PUID>:<PGID> data`.
5. Build and start on the NAS: `docker compose up -d --build`.

Building on the NAS itself produces an image for its CPU (x86-64 or ARM64) with no extra steps; it takes a few
minutes on a small machine. If the NAS cannot build, build on the PC for the NAS's architecture and carry the image:

```bash
docker buildx build --platform linux/arm64 -t minibald:latest --load .
docker save minibald:latest | gzip > minibald.tar.gz
# on the NAS
docker load < minibald.tar.gz
docker compose up -d
```

Use `linux/amd64` for Intel/AMD models. On NAS systems with a container app (Synology Container Manager, QNAP
Container Station, Unraid), create a project from the same `docker-compose.yml`.

Check it is healthy with `docker compose ps`; the app is at `http://<nas-address>:8080`.

## HTTPS

Browsers allow installing a web app, and run its service worker, only over HTTPS (or on `localhost`). Over plain
HTTP the app works fully in the browser, it just cannot be installed.

The server turns HTTPS on by itself when it finds `data/certs/cert.pem` and `data/certs/key.pem` at start-up. It then
serves HTTPS on the same port (plain HTTP on that port stops working). Three ways to get those two files:

### A. mkcert (no cloud, recommended)

[mkcert](https://github.com/FiloSottile/mkcert) creates a private certificate authority on your PC and certificates
signed by it.

```bash
mkcert -install
mkcert -cert-file data/certs/cert.pem -key-file data/certs/key.pem 192.168.1.50 nas.local localhost
docker compose restart
```

List every name and address you will type in the browser. Each **other** device must then trust your authority once:
copy `rootCA.pem` from the folder printed by `mkcert -CAROOT` to the device.

- Android: Settings → Security → Encryption & credentials → Install a certificate → CA certificate.
- iPhone/iPad: open the file, install the profile, then Settings → General → About → Certificate Trust Settings and
  enable it.
- Another PC: import it into the system's trusted root authorities.

Keep `rootCA-key.pem` private: whoever has it can impersonate sites to devices that trust your authority.

### B. The NAS's reverse proxy

Most NAS systems can put their own HTTPS in front of a container (Synology: Control Panel → Login Portal → Advanced
→ Reverse Proxy). Point it at `http://localhost:8080` and leave `data/certs` empty. The certificate is then whatever
the NAS uses.

### C. A real certificate

If you own a domain you can obtain a certificate with a DNS challenge (for example with `acme.sh` or `lego`) without
exposing the NAS to the internet, and place the two files in `data/certs`. This involves an external certificate
authority, so it is outside the "nothing leaves the house" rule; mkcert is not.

After switching, open `https://<address>:8080`. Settings → "Install as an app" shows whether the connection is secure
and offers installation.

## PIN lock

Settings → PIN lock. Each device enters the PIN once and stays unlocked for 30 days. Changing or removing the PIN
signs every other device out. After five wrong attempts in a row the wait doubles from 30 seconds up to 15 minutes.

The PIN keeps other people on your network out of the app. It is not encryption: over plain HTTP the PIN and the
session cookie cross the network unprotected, and the data folder on disk is not locked.

Forgotten PIN: set `RESET_PIN=true` in `.env`, run `docker compose up -d`, then set it back to empty and run it again.

## Backups

- **Automatic**: one consistent database snapshot per day in `data/backups/auto/`, keeping the last `BACKUP_KEEP`
  (default 7, `0` to turn off). Photos are not copied: they are ordinary files.
- **Before upgrades**: the database is copied to `data/backups/` before every schema migration.
- **On demand**: Settings → Backups and export downloads the database alone, or a zip of the database, all photos
  and your extra catalogues.
- **The simple rule**: include the `data` folder in the NAS's own backup or snapshot schedule. That covers everything.

### Restoring

1. `docker compose down`.
2. Full backup: unzip it into an empty data folder. Database only: replace `data/minis.db` with the snapshot and
   delete `data/minis.db-wal` and `data/minis.db-shm` if present.
3. `docker compose up -d`.

## Updating

```bash
git pull
docker compose up -d --build
```

New migrations run on start. If an update misbehaves, the pre-migration copy in `data/backups/` together with the
previous version of the code brings you back.
