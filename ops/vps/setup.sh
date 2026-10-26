#!/usr/bin/env bash
# One-time preparation of a fresh Ubuntu 24.04 VPS for Kelola Kasir (ADR-0012, docs/ops/deploy.md step 4).
# Run as root:  bash setup.sh '<deploy public key: ssh-ed25519 AAAA... github-deploy>'
# Idempotent: running it again only re-applies the same settings.
#
#  - Docker Engine + Compose (Ubuntu packages), log rotation, 2 GB swap
#  - firewall: only SSH, HTTP and HTTPS; fail2ban for SSH; automatic security updates
#  - user "deploy" (docker group, key-only) used by the GitHub deploy workflow
#  - /opt/kelola-kasir + systemd timer for the nightly backup (01:00 WIB)
#  - SSH password login switched off once root has an authorized key
set -euo pipefail

DEPLOY_KEY="${1:?usage: setup.sh '<ssh public key of the GitHub deploy key>'}"
APP_DIR=/opt/kelola-kasir

[[ "$(id -u)" == 0 ]] || { echo "run as root" >&2; exit 1; }
case "$DEPLOY_KEY" in ssh-ed25519\ *|ssh-rsa\ *|ecdsa-*) ;; *) echo "not an SSH public key" >&2; exit 1 ;; esac
grep -q 'VERSION_ID="24.04"' /etc/os-release || echo "warning: tested on Ubuntu 24.04 only" >&2

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq
apt-get install -yq docker.io docker-compose-v2 ufw fail2ban unattended-upgrades curl

# Automatic security updates (reboots stay manual: see runbook § Perawatan server).
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

# Container logs must not fill the 50 GB disk.
mkdir -p /etc/docker
cat >/etc/docker/daemon.json <<'EOF'
{ "log-driver": "local", "log-opts": { "max-size": "20m", "max-file": "5" } }
EOF
systemctl enable --now docker
systemctl restart docker

if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

# Firewall. PostgreSQL is never published by compose.yaml, so only these ports are reachable.
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
systemctl enable --now fail2ban

# Deploy user for GitHub Actions (key only, no password, no sudo).
id deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
touch /home/deploy/.ssh/authorized_keys
grep -qxF "$DEPLOY_KEY" /home/deploy/.ssh/authorized_keys || echo "$DEPLOY_KEY" >>/home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

install -d -m 750 -o deploy -g deploy "$APP_DIR"

cat >/etc/systemd/system/kelola-kasir-backup.service <<EOF
[Unit]
Description=Kelola Kasir nightly database backup (docs/ops/backup-restore.md)
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
User=deploy
WorkingDirectory=$APP_DIR
ExecStart=$APP_DIR/backup-now.sh
EOF
cat >/etc/systemd/system/kelola-kasir-backup.timer <<'EOF'
[Unit]
Description=Kelola Kasir backup at 01:00 WIB

[Timer]
OnCalendar=*-*-* 01:00:00 Asia/Jakarta
RandomizedDelaySec=5min
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now kelola-kasir-backup.timer

# Key-only SSH, but never lock the owner out: only when root already logs in with a key.
if [[ -s /root/.ssh/authorized_keys ]]; then
  cat >/etc/ssh/sshd_config.d/10-kelola-kasir.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
  systemctl reload ssh
  echo "SSH: password login disabled (root logs in with its key)."
else
  echo "warning: /root/.ssh/authorized_keys is empty, SSH password login stays ON." >&2
  echo "         Add your SSH key in hPanel (VPS > Settings > SSH keys), then run this script again." >&2
fi

echo
echo "Done. Next: deploy.md step 5 (.env in $APP_DIR) and step 6 (GitHub secrets, first deploy)."
echo "SSH host key for the GitHub variable VPS_KNOWN_HOSTS:"
ssh-keyscan -t ed25519 localhost 2>/dev/null | sed "s/^localhost/$(curl -fsS -4 --max-time 5 https://ifconfig.me || echo '<vps-ip>')/"
