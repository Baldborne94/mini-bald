// Container health check. The server speaks HTTPS when a certificate is present in the data
// folder, HTTP otherwise, so both are tried. The check talks to 127.0.0.1 only; certificate
// validation is skipped because a home-network certificate is not issued for that address.
import http from 'node:http';
import https from 'node:https';

const port = process.env.PORT ?? 8080;
const probe = (client, options) =>
  new Promise((resolve) => {
    const req = client.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 3000, ...options }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => req.destroy());
  });

const healthy = (await probe(http, {})) || (await probe(https, { rejectUnauthorized: false }));
process.exit(healthy ? 0 : 1);
