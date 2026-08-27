#!/usr/bin/env bash
# Installer for panel as a plain web service on a VM (no Pi kiosk display).
#
# Sets up the Fastify server on 127.0.0.1:4000 behind a reverse proxy that
# you configure separately (see deploy/reverse-proxy/). Run as the user that
# should own the service (NOT root); it sudos only where needed.
set -euo pipefail

PANEL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PANEL_USER="${SUDO_USER:-$USER}"

echo "==> Installing panel (VM / web-service mode)"
echo "    dir:  $PANEL_DIR"
echo "    user: $PANEL_USER"

cd "$PANEL_DIR"
if [ ! -f .env ]; then
  echo "==> Creating .env from .env.example (edit it after install)"
  cp .env.example .env
fi

echo "==> npm install"
npm install
echo "==> npm run build"
npm run build

# data/ holds persisted monthly counters; ProtectSystem=strict needs it to
# already exist as a ReadWritePath.
mkdir -p "$PANEL_DIR/data"

SERVICE_FILE=/etc/systemd/system/panel.service
echo "==> Writing $SERVICE_FILE"
sudo sed \
  -e "s|__USER__|$PANEL_USER|g" \
  -e "s|__PANEL_DIR__|$PANEL_DIR|g" \
  "$PANEL_DIR/deploy/panel-vm.service" | sudo tee "$SERVICE_FILE" >/dev/null

sudo systemctl daemon-reload
sudo systemctl enable panel.service
sudo systemctl restart panel.service

echo
echo "==> panel server installed and running on http://127.0.0.1:4000"
echo "    status: sudo systemctl status panel"
echo "    logs:   journalctl -u panel -f"
echo
echo "==> Next: put a reverse proxy in front of it for TLS + a hostname."
echo "    Caddy (auto-TLS, simplest):"
echo "        sudo cp deploy/reverse-proxy/Caddyfile /etc/caddy/Caddyfile   # edit hostname"
echo "        sudo systemctl reload caddy"
echo "    Apache:"
echo "        sudo a2enmod proxy proxy_http proxy_wstunnel headers rewrite ssl"
echo "        sudo cp deploy/reverse-proxy/apache-panel.conf /etc/apache2/sites-available/panel.conf"
echo "        sudo a2ensite panel && sudo systemctl reload apache2"
echo
echo "==> Confirm the VM can reach the monitored gear:"
echo "        the UDM (SNMP + legacy API) and the UPS (SNMP) must be routable"
echo "        from this host, or the poller stays in mock/degraded mode."
