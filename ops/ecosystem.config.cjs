// PM2 process file for a server without Docker, laid out as in docs/DEPLOY_VPS.md:
//   /srv/restrovia/{cloud,env}
// The API runs the cleanup and notification jobs in-process, so it stays a single instance.
const path = require('node:path');

const ROOT = process.env.RESTROVIA_ROOT || '/srv/restrovia';
const REPO = `${ROOT}/cloud`;
const ENV_FILE = `${ROOT}/env/cloud.env`;
const NEXT_BIN = path.join(REPO, 'node_modules/next/dist/bin/next');

const nextApp = (name, port, memory) => ({
  name: `restrovia-${name}`,
  cwd: `${REPO}/apps/${name}`,
  script: NEXT_BIN,
  args: `start -p ${port} -H 127.0.0.1`,
  instances: 1,
  exec_mode: 'fork',
  env: { NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' },
  max_memory_restart: memory,
});

module.exports = {
  apps: [
    {
      name: 'restrovia-api',
      cwd: `${REPO}/apps/api`,
      script: 'dist/main.js',
      node_args: `--env-file=${ENV_FILE}`,
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production', PORT: 4000, HOST: '127.0.0.1' },
      max_memory_restart: '600M',
    },
    nextApp('admin', 3100, '500M'),
    nextApp('owner', 3200, '500M'),
  ],
};
