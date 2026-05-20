#!/usr/bin/env bash
# Render scripts/env.template into a .env file with freshly generated secrets.
#
# Generates (base64url, URL-safe inside the postgres:// strings docker-compose builds):
#   POSTGRES_ADMIN_PASSWORD, POSTGRES_APP_PASSWORD, LITELLM_MASTER_KEY
# Leaves REPLACE_ME_* placeholders for ANTHROPIC_API_KEY and the SLACK_* values.
#
# Usage: scripts/scaffold-env.sh [target]   (default target: /opt/ops-manager/.env)
# Refuses to overwrite an existing target. Secrets are only ever written to the
# target file, never to stdout.
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
template="$repo_dir/scripts/env.template"
target="${1:-/opt/ops-manager/.env}"

[ -f "$template" ] || { echo "template not found: $template" >&2; exit 1; }
[ -e "$target" ] && { echo "refusing to overwrite existing $target" >&2; exit 1; }

gen() { openssl rand -base64 32 | tr '+/' '-_' | tr -d '='; }
pg_admin="$(gen)"
pg_app="$(gen)"
litellm_key="sk-$(gen)"

umask 077
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
cp "$template" "$tmp"
sed -i "s|__GEN_POSTGRES_ADMIN_PASSWORD__|${pg_admin}|" "$tmp"
sed -i "s|__GEN_POSTGRES_APP_PASSWORD__|${pg_app}|" "$tmp"
sed -i "s|__GEN_LITELLM_MASTER_KEY__|${litellm_key}|" "$tmp"

grep -q '__GEN_' "$tmp" && { echo "unsubstituted __GEN_ token remains" >&2; exit 1; }

chmod 600 "$tmp"
mv "$tmp" "$target"
trap - EXIT
chmod 600 "$target"
[ "$(id -u)" = "0" ] && chown root:root "$target"
echo "wrote $target"
