FROM postgres:16

# Install pglogical extension
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       postgresql-16-pglogical \
    && rm -rf /var/lib/apt/lists/*

# Copy custom configs
COPY postgresql.conf /etc/postgresql/custom.conf
COPY pg_hba_append.conf /tmp/pg_hba_append.conf
COPY init-pglogical.sh /docker-entrypoint-initdb.d/00-init-pglogical.sh

RUN chmod +x /docker-entrypoint-initdb.d/00-init-pglogical.sh

# Append our custom config to the default
CMD ["postgres", "-c", "config_file=/etc/postgresql/custom.conf"]
