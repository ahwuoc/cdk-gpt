#!/usr/bin/env bash
set -euo pipefail

until mongosh --host mongodb:27017 --quiet --eval 'quit(db.adminCommand({ping:1}).ok ? 0 : 2)'; do sleep 2; done
mongosh --host mongodb:27017 --quiet <<'EOF'
try {
  const status = rs.status();
  if (status.ok === 1) print('Replica set already initialized');
} catch (error) {
  if (error.codeName === 'NotYetInitialized' || error.code === 94) {
    rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'mongodb:27017', priority: 1 }] });
  } else { throw error; }
}
EOF
until mongosh --host mongodb:27017 --quiet --eval 'quit(db.hello().isWritablePrimary ? 0 : 2)'; do sleep 2; done
echo 'MongoDB replica set rs0 is writable'
