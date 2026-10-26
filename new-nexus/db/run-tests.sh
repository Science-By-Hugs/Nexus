#!/usr/bin/env bash
# Creates a throwaway database, applies every migration, runs db/tests/*.sql,
# then drops it. Never point this at Neon production or staging.
#
# Usage: ADMIN_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres ./new-nexus/db/run-tests.sh
set -euo pipefail

: "${ADMIN_DATABASE_URL:?Set ADMIN_DATABASE_URL to a local Postgres admin connection}"
here="$(cd "$(dirname "$0")" && pwd)"
db="nexus_test_$$"
base="${ADMIN_DATABASE_URL%/*}"

psql "$ADMIN_DATABASE_URL" -X -q -c "CREATE DATABASE $db"
trap 'psql "$ADMIN_DATABASE_URL" -X -q -c "DROP DATABASE IF EXISTS $db WITH (FORCE)"' EXIT

DATABASE_URL="$base/$db" "$here/migrate.sh"
DATABASE_URL="$base/$db" "$here/migrate.sh"   # second run must be a no-op

for test in "$here"/tests/*.sql; do
  echo "test   $(basename "$test")"
  psql "$base/$db" -X -q -v ON_ERROR_STOP=1 -f "$test"
done
