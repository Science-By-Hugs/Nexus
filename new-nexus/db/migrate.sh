#!/usr/bin/env bash
# Applies new-nexus/db/migrations/*.sql in order, each in its own transaction,
# recording what ran in schema_migrations. Safe to re-run.
#
# Usage: DATABASE_URL=postgres://... ./new-nexus/db/migrate.sh
# Use the Neon *direct* (non-pooled) connection string for migrations.
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the target database}"
dir="$(cd "$(dirname "$0")/migrations" && pwd)"
psql_cmd=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -q)

"${psql_cmd[@]}" -c "SET client_min_messages = warning; CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);"

for file in "$dir"/*.sql; do
  name="$(basename "$file")"
  applied="$("${psql_cmd[@]}" -tA -c "SELECT 1 FROM schema_migrations WHERE name = '$name'")"
  if [[ "$applied" == "1" ]]; then
    echo "skip   $name"
    continue
  fi
  echo "apply  $name"
  { cat "$file"; echo; echo "INSERT INTO schema_migrations (name) VALUES ('$name');"; } \
    | "${psql_cmd[@]}" --single-transaction -f -
done
echo "done"
