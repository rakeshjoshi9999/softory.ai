// Minimal npm registry for the Renovate dry run: serves packuments for @factory/* packages
// with the versions given in FIXTURE_VERSIONS (default 1.0.1,1.1.0). Local, no publishing.
import { createServer } from 'node:http';

const versions = (process.env.FIXTURE_VERSIONS ?? '1.0.1,1.1.0').split(',');
const port = Number(process.env.PORT ?? 4873);

createServer((req, res) => {
  const name = decodeURIComponent((req.url ?? '').split('?')[0].replace(/^\//, ''));
  if (!name.startsWith('@factory/')) {
    res.writeHead(404).end('{}');
    return;
  }
  const doc = {
    name,
    'dist-tags': { latest: versions[versions.length - 1] },
    versions: Object.fromEntries(
      versions.map((v) => [v, { name, version: v, dist: { tarball: `http://localhost:${port}/${name}/-/${v}.tgz` } }]),
    ),
    time: Object.fromEntries(versions.map((v) => [v, '2026-10-01T00:00:00.000Z'])),
  };
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(doc));
}).listen(port, () => console.log(`mock registry on :${port}`));
