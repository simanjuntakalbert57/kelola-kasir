#!/usr/bin/env bash
# One-time preparation of a fresh VPS for Kelola Kasir (ADR-0012, docs/ops/deploy.md step 4).
# Supported OS: Ubuntu 24.04, or AlmaLinux/Rocky Linux 8 or 9 (the Rumahweb VPS runs AlmaLinux 8.9).
# Run as root:  bash setup.sh '<deploy public key: ssh-ed25519 AAAA... github-deploy>'
# Idempotent: running it again only re-applies the same settings.
#
#  - Docker Engine + Compose (Ubuntu packages, or Docker CE on AlmaLinux/Rocky), log rotation, 2 GB swap
#  - firewall (ufw or firewalld): only SSH, HTTP and HTTPS; fail2ban for SSH; automatic security updates
#  - user "deploy" (docker group, key-only) used by the GitHub deploy workflow
#  - /opt/kelola-kasir + systemd timer for the nightly backup (01:00 WIB)
#  - SSH password login switched off once root has an authorized key
set -euo pipefail

DEPLOY_KEY="${1:?usage: setup.sh '<ssh public key of the GitHub deploy key>'}"
APP_DIR=/opt/kelola-kasir

[[ "$(id -u)" == 0 ]] || { echo "run as root" >&2; exit 1; }
case "$DEPLOY_KEY" in ssh-ed25519\ *|ssh-rsa\ *|ecdsa-*) ;; *) echo "not an SSH public key" >&2; exit 1 ;; esac
# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}:${VERSION_ID%%.*}" in
  ubuntu:*) os=ubuntu; [[ "$VERSION_ID" == 24.04 ]] || echo "warning: tested on Ubuntu 24.04 only" >&2 ;;
  almalinux:8 | almalinux:9 | rocky:8 | rocky:9) os=el ;;
  *) echo "unsupported OS: ${PRETTY_NAME:-unknown}. Use Ubuntu 24.04 or AlmaLinux 8/9." >&2; exit 1 ;;
esac
# Docker needs a full kernel: OpenVZ/LXC containers are not supported.
virt="$(systemd-detect-virt 2>/dev/null || true)"
case "$virt" in openvz|lxc|lxc-libvirt) echo "this VPS is $virt; Docker needs a KVM VPS" >&2; exit 1 ;; esac

# Packages and automatic security updates (reboots stay manual: see runbook § Perawatan server).
if [[ "$os" == ubuntu ]]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  apt-get upgrade -yq
  apt-get install -yq docker.io docker-compose-v2 ufw fail2ban unattended-upgrades python3-systemd curl tar
  cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
else
  dnf -y upgrade
  # podman/runc from AppStream conflict with Docker CE's containerd.io.
  dnf -y remove podman buildah runc || true
  dnf -y install dnf-plugins-core epel-release
  dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
  dnf -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin \
    firewalld fail2ban python3-systemd dnf-automatic curl tar
  sed -i -e 's/^upgrade_type *=.*/upgrade_type = security/' -e 's/^apply_updates *=.*/apply_updates = yes/' \
    /etc/dnf/automatic.conf
  systemctl enable --now dnf-automatic.timer
fi

# Container logs must not fill the 50 GB disk.
mkdir -p /etc/docker
cat >/etc/docker/daemon.json <<'EOF'
{ "log-driver": "local", "log-opts": { "max-size": "20m", "max-file": "5" } }
EOF
systemctl enable --now docker
systemctl restart docker

if ! swapon --show | grep -q /swapfile; then
  # dd, not fallocate: XFS (AlmaLinux default) rejects preallocated swap files.
  dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

# Firewall. PostgreSQL is never published by compose.yaml, so only these ports are reachable.
if [[ "$os" == ubuntu ]]; then
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow OpenSSH
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow 443/udp
  ufw --force enable
else
  systemctl enable --now firewalld
  firewall-cmd --permanent --add-service=ssh --add-service=http --add-service=https --add-port=443/udp
  firewall-cmd --reload
fi
# The sshd jail is on by default only in Debian/Ubuntu packaging.
cat >/etc/fail2ban/jail.d/kelola-kasir.local <<'EOF'
[sshd]
enabled = true
backend = systemd
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

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
# ChallengeResponseAuthentication (not KbdInteractiveAuthentication) because OpenSSH 8.0 on EL8 lacks the latter.
if [[ -s /root/.ssh/authorized_keys ]]; then
  ssh_unit=ssh
  [[ "$os" == el ]] && ssh_unit=sshd
  mkdir -p /etc/ssh/sshd_config.d
  # EL8's sshd_config has no Include; the first value wins, so it must be the first line.
  grep -q '^Include /etc/ssh/sshd_config.d/' /etc/ssh/sshd_config ||
    sed -i '1i Include /etc/ssh/sshd_config.d/*.conf' /etc/ssh/sshd_config
  cat >/etc/ssh/sshd_config.d/10-kelola-kasir.conf <<'EOF'
PasswordAuthentication no
ChallengeResponseAuthentication no
PermitRootLogin prohibit-password
EOF
  # A config sshd rejects would stop it from starting after the next reboot: undo it instead.
  if ! sshd -t; then
    rm -f /etc/ssh/sshd_config.d/10-kelola-kasir.conf
    echo "sshd rejected the key-only config; SSH settings left unchanged" >&2
    exit 1
  fi
  systemctl reload "$ssh_unit"
  echo "SSH: password login disabled (root logs in with its key)."
else
  echo "warning: /root/.ssh/authorized_keys is empty, SSH password login stays ON." >&2
  echo "         From your laptop run: ssh-copy-id root@<vps-ip>, then run this script again." >&2
fi

echo
echo "Done. Next: deploy.md step 5 (.env in $APP_DIR) and step 6 (GitHub secrets, first deploy)."
echo "SSH host key for the GitHub variable VPS_KNOWN_HOSTS:"
ssh-keyscan -t ed25519 localhost 2>/dev/null | sed "s/^localhost/$(curl -fsS -4 --max-time 5 https://ifconfig.me || echo '<vps-ip>')/"
