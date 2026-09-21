#!/bin/sh
set -e

wait_for_database() {
  attempts="${DB_WAIT_ATTEMPTS:-60}"
  attempt=0

  until node -e '
    const net = require("net");
    const socket = net.connect({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 5432),
    });
    socket.setTimeout(2000, () => { socket.destroy(); process.exit(1); });
    socket.on("connect", () => { socket.end(); process.exit(0); });
    socket.on("error", () => process.exit(1));
  ' 2>/dev/null; do
    attempt=$((attempt + 1))

    if [ "$attempt" -ge "$attempts" ]; then
      echo "Database at ${DB_HOST}:${DB_PORT:-5432} is unreachable after ${attempts} attempts" >&2
      exit 1
    fi

    echo "Waiting for the database (${attempt}/${attempts})..."
    sleep 2
  done
}

wait_for_database

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "Applying database migrations..."
  node ./node_modules/typeorm/cli.js migration:run --dataSource dist/datasource.js
fi

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

exec node dist/src/main.js
