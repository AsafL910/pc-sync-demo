#!/bin/bash
set -e

# Append custom HBA rules to allow replication
cat /tmp/pg_hba_append.conf >> "$PGDATA/pg_hba.conf"

# Create pglogical extension in the default database
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE EXTENSION IF NOT EXISTS postgis;
    CREATE EXTENSION IF NOT EXISTS pglogical;
EOSQL
