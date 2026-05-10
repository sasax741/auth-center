#!/bin/sh
set -e
echo "Running database migrations..."
node ./node_modules/typeorm/cli.js migration:run --dataSource dist/datasource.js
echo "Migrations complete. Starting application..."
exec node dist/src/main
