#!/usr/bin/env bash
# Create the VAPID key pair for Web Push notifications (ADR-0017 §9) on the VPS and restart the API.
# The private key is generated HERE, written only to .env (mode 600) and never printed, so it never reaches CI logs.
# Idempotent: when VAPID_PRIVATE_KEY is already set nothing is changed. Rotating the keys invalidates every
# browser subscription (owners must enable notifications again), so there is deliberately no "rotate" option.
# Run by Actions → Configure Web Push, or by hand as deploy in /opt/kelola-kasir.
set -Eeuo pipefail
cd "$(dirname "$0")"
umask 077

SUBJECT_DEFAULT="https://kelola-kasir.pages.dev"

current_private="$(sed -n 's/^VAPID_PRIVATE_KEY=//p' .env | tail -n 1)"
if [[ -n "$current_private" ]]; then
  echo "web-push: VAPID keys already configured, leaving .env unchanged"
else
  # Keys come from the API image, which already has web-push. Output: two lines, public then private.
  keys="$(./compose.sh run --rm --no-deps --no-TTY --entrypoint node api -e \
    "const k=require('web-push').generateVAPIDKeys();console.log(k.publicKey);console.log(k.privateKey)")"
  public="$(printf '%s\n' "$keys" | sed -n 1p)"
  private="$(printf '%s\n' "$keys" | sed -n 2p)"
  [[ "$public" =~ ^[A-Za-z0-9_-]{87}$ && "$private" =~ ^[A-Za-z0-9_-]{43}$ ]] || {
    echo "web-push: key generation returned an unexpected value" >&2
    exit 1
  }
  cp -p .env .env.webpush-bak
  # Drop any empty placeholders, then append the three lines (value never echoed).
  grep -v -E '^(VAPID_PUBLIC_KEY|VAPID_PRIVATE_KEY|VAPID_SUBJECT)=' .env > .env.webpush-new || true
  {
    printf 'VAPID_PUBLIC_KEY=%s\n' "$public"
    printf 'VAPID_PRIVATE_KEY=%s\n' "$private"
    printf 'VAPID_SUBJECT=%s\n' "$SUBJECT_DEFAULT"
  } >> .env.webpush-new
  mv .env.webpush-new .env
  unset keys private
  echo "web-push: VAPID keys written to .env"
fi

./compose.sh up -d --wait --wait-timeout 240
./compose.sh exec -T api wget -qO- http://127.0.0.1:3000/healthz | grep -q '"db":"up"'
rm -f .env.webpush-bak
echo "web-push: api healthy ($(date -u +%FT%TZ))"
