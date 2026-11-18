#!/usr/bin/env bash
# MTerm - instalacija / nadogradnja na Debian/Ubuntu (LXC, VM ili fizički server)
#
#   curl -fsSL https://raw.githubusercontent.com/moordrak/MTerm/main/scripts/install.sh | bash
#
# Varijable okruženja (opcionalno):
#   MTERM_VERSION   verzija (npr. v1.0.0), zadano: zadnji release
#   MTERM_PORT      port web sučelja (zadano 8080)
#   MTERM_USER      korisnik za prijavu (zadano admin)
#   MTERM_PASSWORD  lozinka za prijavu (zadano: nasumična, ispisuje se na kraju)
#   MTERM_DIR       instalacijska mapa (zadano /opt/mterm)
set -euo pipefail

REPO="moordrak/MTerm"
MTERM_DIR="${MTERM_DIR:-/opt/mterm}"
ENV_FILE="/etc/mterm/mterm.env"
NODE_MAJOR=22

c_ok="\e[32m"; c_info="\e[36m"; c_err="\e[31m"; c_off="\e[0m"
info() { echo -e "${c_info}==>${c_off} $*"; }
ok()   { echo -e "${c_ok}✔${c_off} $*"; }
die()  { echo -e "${c_err}✘ $*${c_off}" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Pokrenite skriptu kao root."
command -v apt-get >/dev/null || die "Podržani su samo Debian/Ubuntu sustavi (apt)."

export DEBIAN_FRONTEND=noninteractive

info "Instalacija osnovnih paketa..."
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg tar openssl >/dev/null

# Node.js
need_node=1
if command -v node >/dev/null; then
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 18 ] && need_node=0
fi
if [ "$need_node" -eq 1 ]; then
  info "Instalacija Node.js ${NODE_MAJOR}..."
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs >/dev/null
fi
ok "Node.js $(node -v)"

# Verzija
if [ -z "${MTERM_VERSION:-}" ]; then
  MTERM_VERSION="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null \
    | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/' || true)"
fi
if [ -n "${MTERM_VERSION:-}" ]; then
  URL="https://github.com/${REPO}/archive/refs/tags/${MTERM_VERSION}.tar.gz"
else
  MTERM_VERSION="main"
  URL="https://github.com/${REPO}/archive/refs/heads/main.tar.gz"
fi

info "Preuzimanje MTerm ${MTERM_VERSION}..."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$URL" -o "$tmp/mterm.tar.gz"
mkdir -p "$tmp/src"
tar -xzf "$tmp/mterm.tar.gz" -C "$tmp/src" --strip-components=1

id mterm >/dev/null 2>&1 || useradd --system --home-dir "$MTERM_DIR" --shell /usr/sbin/nologin mterm

systemctl stop mterm 2>/dev/null || true
mkdir -p "$MTERM_DIR"
rm -rf "$MTERM_DIR/server" "$MTERM_DIR/public" "$MTERM_DIR/node_modules"
cp -r "$tmp/src/server" "$tmp/src/public" "$tmp/src/package.json" "$MTERM_DIR/"
cp "$tmp/src/scripts/install.sh" /usr/local/bin/mterm-update
chmod 755 /usr/local/bin/mterm-update

info "Instalacija npm ovisnosti..."
(cd "$MTERM_DIR" && npm install --omit=dev --no-audit --no-fund --loglevel=error)
chown -R mterm:mterm "$MTERM_DIR"

# Konfiguracija (postojeća se zadržava kod nadogradnje)
GENERATED_PASSWORD=""
if [ ! -f "$ENV_FILE" ]; then
  mkdir -p /etc/mterm
  if [ -z "${MTERM_PASSWORD:-}" ]; then
    MTERM_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)"
    GENERATED_PASSWORD="$MTERM_PASSWORD"
  fi
  cat > "$ENV_FILE" <<EOF
# MTerm konfiguracija - nakon izmjene: systemctl restart mterm
PORT=${MTERM_PORT:-8080}
MTERM_USER=${MTERM_USER:-admin}
MTERM_PASSWORD=${MTERM_PASSWORD}
MTERM_SESSION_HOURS=12
MTERM_IDLE_MINUTES=30
EOF
  chmod 600 "$ENV_FILE"
fi

cat > /etc/systemd/system/mterm.service <<EOF
[Unit]
Description=MTerm web terminal
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=mterm
Group=mterm
WorkingDirectory=${MTERM_DIR}
EnvironmentFile=${ENV_FILE}
Environment=NODE_ENV=production
ExecStart=$(command -v node) ${MTERM_DIR}/server/index.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=${MTERM_DIR}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now mterm >/dev/null 2>&1
sleep 2
systemctl is-active --quiet mterm || { journalctl -u mterm -n 30 --no-pager; die "Servis mterm se nije pokrenuo."; }

PORT_NOW="$(grep -E '^PORT=' "$ENV_FILE" | cut -d= -f2)"
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
ok "MTerm ${MTERM_VERSION} je instaliran i pokrenut."
echo -e "   Adresa:   ${c_info}http://${IP:-localhost}:${PORT_NOW:-8080}${c_off}"
if [ -n "$GENERATED_PASSWORD" ]; then
  echo -e "   Korisnik: ${MTERM_USER:-admin}"
  echo -e "   Lozinka:  ${c_ok}${GENERATED_PASSWORD}${c_off}  (spremljeno u ${ENV_FILE})"
fi
echo "   Nadogradnja: mterm-update"
