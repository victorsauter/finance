#!/bin/sh
# Runs every supabase/tests/*.sql file against the local Supabase database.
# psql is not installed on the host, so it runs inside the local db container.
# Start the stack first: npx supabase start (see supabase/config.toml for the ports).
set -u

root=$(cd "$(dirname "$0")/.." && pwd)

# The CLI names the container supabase_db_<project_id>.
project_id=$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' "$root/supabase/config.toml")
container="supabase_db_${project_id}"

if ! docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null | grep -q true; then
  echo "Container $container is not running. Start it with: npx supabase start" >&2
  exit 1
fi

status=0
for file in "$root"/supabase/tests/*.sql; do
  echo "== $(basename "$file")"
  if ! docker exec -i "$container" \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 -X -q -t -A <"$file"; then
    echo "FAIL: $(basename "$file")" >&2
    status=1
  fi
done

exit "$status"
