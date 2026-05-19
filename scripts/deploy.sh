#!/usr/bin/env bash
# Ops Manager — manual deploy to n8n droplet
#
# Fill in before first deploy:
#   DROPLET_IP=<your n8n droplet IP>
#   SSH_KEY=~/.ssh/id_ed25519
#   DEPLOY_PATH=/opt/ops-manager
#
# Usage:
#   ./scripts/deploy.sh
#
# What it does:
#   1. SSH to droplet
#   2. cd DEPLOY_PATH && git pull origin main
#   3. docker compose up -d --build
#   App listens on host port 3100 -> container 3000

set -euo pipefail

DROPLET_IP="${DROPLET_IP:-YOUR_DROPLET_IP}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/ops-manager}"

ssh -i "$SSH_KEY" "root@${DROPLET_IP}" <<EOF
  set -euo pipefail
  cd "${DEPLOY_PATH}"
  git pull origin main
  docker compose up -d --build
  curl -sf http://localhost:3100/health || echo "Health check failed — check logs: docker compose logs app"
EOF
