#!/usr/bin/env bash
# MTerm - kreiranje LXC kontejnera na Proxmox VE hostu
#
# Pokrenite na Proxmox hostu (shell čvora) kao root:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/moordrak/MTerm/main/scripts/proxmox-lxc.sh)"
#
# Bez pitanja (zadane vrijednosti ili varijable okruženja):
#   CTID=120 IP=192.168.1.50/24 GW=192.168.1.1 bash proxmox-lxc.sh -y
#
# Varijable: CTID CT_HOSTNAME CORES MEMORY SWAP DISK STORAGE TEMPLATE_STORAGE BRIDGE IP GW VLAN
#            MTERM_PORT MTERM_USER MTERM_PASSWORD MTERM_VERSION
set -euo pipefail

INSTALL_URL="https://raw.githubusercontent.com/moordrak/MTerm/main/scripts/install.sh"

c_ok="\e[32m"; c_info="\e[36m"; c_err="\e[31m"; c_y="\e[33m"; c_off="\e[0m"
info() { echo -e "${c_info}==>${c_off} $*"; }
ok()   { echo -e "${c_ok}✔${c_off} $*"; }
die()  { echo -e "${c_err}✘ $*${c_off}" >&2; exit 1; }

YES=0
for a in "$@"; do
  case "$a" in
    -y|--yes) YES=1 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "Pokrenite kao root na Proxmox hostu."
command -v pct >/dev/null || die "Naredba 'pct' nije pronađena - ovo nije Proxmox VE host."

ask() { # ask VAR "Pitanje" default
  local var="$1" q="$2" def="$3" val
  if [ -n "${!var:-}" ]; then return; fi
  if [ "$YES" -eq 1 ] || [ ! -t 0 ]; then printf -v "$var" '%s' "$def"; return; fi
  read -rp "$(echo -e "${c_y}?${c_off} ${q} [${def}]: ")" val
  printf -v "$var" '%s' "${val:-$def}"
}

# Zadane vrijednosti
DEF_CTID="$(pvesh get /cluster/nextid 2>/dev/null || echo 100)"
DEF_STORAGE="$(pvesm status -content rootdir 2>/dev/null | awk 'NR>1 && $3=="active" {print $1}' | grep -m1 -x 'local-lvm' \
  || pvesm status -content rootdir 2>/dev/null | awk 'NR>1 && $3=="active" {print $1; exit}')"
DEF_TSTORAGE="$(pvesm status -content vztmpl 2>/dev/null | awk 'NR>1 && $3=="active" {print $1}' | grep -m1 -x 'local' \
  || pvesm status -content vztmpl 2>/dev/null | awk 'NR>1 && $3=="active" {print $1; exit}')"

echo -e "\n${c_info}  >_ MTerm - Proxmox LXC instalacija${c_off}\n"
ask CTID "ID kontejnera" "$DEF_CTID"
ask CT_HOSTNAME "Hostname" "mterm"
ask CORES "Broj jezgri" "1"
ask MEMORY "RAM (MB)" "512"
ask SWAP "Swap (MB)" "512"
ask DISK "Disk (GB)" "4"
ask STORAGE "Storage za disk" "${DEF_STORAGE:-local-lvm}"
ask TEMPLATE_STORAGE "Storage za predloške" "${DEF_TSTORAGE:-local}"
ask BRIDGE "Mrežni bridge" "vmbr0"
ask IP "IP adresa (dhcp ili npr. 192.168.1.50/24)" "dhcp"
if [ "$IP" != "dhcp" ]; then ask GW "Gateway" ""; else GW="${GW:-}"; fi
ask VLAN "VLAN tag (prazno = bez)" ""
ask MTERM_PORT "Port MTerm sučelja" "8080"
ask MTERM_USER "Korisnik za prijavu u MTerm" "admin"
if [ -z "${MTERM_PASSWORD:-}" ] && [ "$YES" -eq 0 ] && [ -t 0 ]; then
  read -rsp "$(echo -e "${c_y}?${c_off} Lozinka za MTerm (prazno = nasumična): ")" MTERM_PASSWORD; echo
fi
MTERM_PASSWORD="${MTERM_PASSWORD:-$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)}"

pct status "$CTID" >/dev/null 2>&1 && die "Kontejner ${CTID} već postoji."

# Predložak: najnoviji Debian (13, inače 12)
info "Traženje Debian predloška..."
pveam update >/dev/null 2>&1 || true
TEMPLATE=""
for v in 13 12; do
  TEMPLATE="$(pveam available --section system 2>/dev/null | awk '{print $2}' | grep -E "^debian-${v}-standard_.*_amd64" | sort -V | tail -1 || true)"
  [ -n "$TEMPLATE" ] && break
done

if [ -z "$TEMPLATE" ]; then
  TEMPLATE="$(pveam list "$TEMPLATE_STORAGE" 2>/dev/null | awk '{print $1}' | grep -E 'debian-1[23]-standard' | sed 's#.*/##' | sort -V | tail -1 || true)"
fi
[ -n "$TEMPLATE" ] || die "Debian predložak nije pronađen."
if ! pveam list "$TEMPLATE_STORAGE" | grep -q "$TEMPLATE"; then
  info "Preuzimanje predloška ${TEMPLATE}..."
  pveam download "$TEMPLATE_STORAGE" "$TEMPLATE" >/dev/null
fi
ok "Predložak: ${TEMPLATE}"

NET="name=eth0,bridge=${BRIDGE},ip=${IP}"
[ -n "${GW:-}" ] && NET+=",gw=${GW}"
[ -n "${VLAN:-}" ] && NET+=",tag=${VLAN}"
[ "$IP" = "dhcp" ] && NET+=",ip6=auto"

ROOTPW="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-20)"

info "Kreiranje kontejnera ${CTID} (${CT_HOSTNAME})..."
pct create "$CTID" "${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}" \
  --hostname "$CT_HOSTNAME" \
  --cores "$CORES" --memory "$MEMORY" --swap "$SWAP" \
  --rootfs "${STORAGE}:${DISK}" \
  --net0 "$NET" \
  --ostype debian --unprivileged 1 --features nesting=1 \
  --onboot 1 --tags mterm \
  --description "MTerm web terminal - https://github.com/moordrak/MTerm" \
  --password "$ROOTPW" >/dev/null
ok "Kontejner kreiran."

pct start "$CTID"
info "Čekanje mreže..."
for i in $(seq 1 60); do
  if pct exec "$CTID" -- bash -c 'getent hosts deb.debian.org >/dev/null 2>&1'; then break; fi
  sleep 2
  [ "$i" -eq 60 ] && die "Kontejner nema mrežu/DNS. Provjerite postavke mreže."
done
ok "Mreža radi."

info "Instalacija MTerma u kontejner..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo /nonexistent)"
pct exec "$CTID" -- bash -c "apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl ca-certificates >/dev/null"
if [ -f "$SCRIPT_DIR/install.sh" ]; then
  pct push "$CTID" "$SCRIPT_DIR/install.sh" /root/mterm-install.sh --perms 755
else
  pct exec "$CTID" -- bash -c "curl -fsSL '$INSTALL_URL' -o /root/mterm-install.sh && chmod 755 /root/mterm-install.sh"
fi
pct exec "$CTID" -- env \
  MTERM_PORT="$MTERM_PORT" MTERM_USER="$MTERM_USER" MTERM_PASSWORD="$MTERM_PASSWORD" MTERM_VERSION="${MTERM_VERSION:-}" \
  bash /root/mterm-install.sh
pct exec "$CTID" -- rm -f /root/mterm-install.sh

CT_IP="$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo -e "${c_ok}════════════════════════════════════════════════════${c_off}"
ok "MTerm je spreman u LXC ${CTID} (${CT_HOSTNAME})"
echo -e "   Adresa:        ${c_info}http://${CT_IP:-<IP>}:${MTERM_PORT}${c_off}"
echo -e "   Korisnik:      ${MTERM_USER}"
echo -e "   Lozinka:       ${MTERM_PASSWORD}"
echo -e "   Root lozinka kontejnera: ${ROOTPW}"
echo -e "   Nadogradnja:   pct exec ${CTID} -- mterm-update"
echo -e "${c_ok}════════════════════════════════════════════════════${c_off}"
