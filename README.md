# MTerm

**MTerm** je web terminal i upravitelj datoteka koji radi u pregledniku. Sučelje je čisti HTML/CSS/JS,
a mali Node.js poslužitelj radi kao most prema udaljenim serverima.

| Protokol | Namjena |
|---|---|
| **SSH** | interaktivni terminal (xterm.js, 256 boja, promjena veličine, kopiraj/zalijepi) |
| **SFTP** | pregled, slanje, preuzimanje, preimenovanje, brisanje, nove mape |
| **SCP** | prijenos pravim SCP protokolom (`scp -t` / `scp -f`), pregled mapa preko SSH |
| **FTP** | klasični FTP |
| **FTPS** | eksplicitni (AUTH TLS, port 21) i implicitni (port 990) |
| **WebDAV / WebDAVS** | http i https (Nextcloud, ownCloud, Synology, Apache/nginx DAV...) |

Mogućnosti:

- više tabova istovremeno (terminali i upravitelji datoteka)
- spremljene veze s grupama i pretraživanjem: u pregledniku **ili na serveru** (dostupne sa svih uređaja,
  lozinke šifrirane AES-256-GCM)
- 20 tema terminala (Dracula, Nord, Gruvbox, Tokyo Night, Catppuccin, Synthwave, Matrix, Jantar...),
  sučelje se automatski usklađuje s temom, vlastita akcentna boja
- dinamičke pozadine: gradijent, aurora, Matrix kiša, svemir, mreža čestica, valovi, mjehurići, snijeg,
  retro mreža ili vlastita slika (URL)
- prozirnost terminala i sučelja te zamućenje pozadine (stakleni efekt)
- bočni izbornik se može sakriti (gumb ☰ ili Ctrl+Shift+B) ili automatski pojaviti uz lijevi rub ekrana
- izvoz/uvoz veza u JSON (bez lozinki)
- prijava lozinkom ili privatnim ključem (uz passphrase), keyboard-interactive
- gumb **SFTP** u SSH tabu otvara datoteke istog servera
- slanje datoteka i **cijelih mapa** (gumb ili povuci-i-ispusti) s prikazom napretka
- opcija za self-signed TLS certifikate (FTPS/WebDAVS)
- zaštita pristupa samom MTermu korisnikom i lozinkom
- Docker image (amd64 + arm64) i skripta za Proxmox LXC

## Instalacija

### 1. Proxmox LXC (preporučeno za homelab)

Na Proxmox hostu (shell čvora), kao root:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/moordrak/MTerm/main/scripts/proxmox-lxc.sh)"
```

Skripta pita za ID, hostname, resurse, storage, bridge, IP i lozinku, preuzima najnoviji Debian predložak,
kreira neprivilegirani kontejner, instalira Node.js i MTerm kao systemd servis te na kraju ispiše adresu i lozinku.

Bez pitanja:

```bash
CTID=150 IP=192.168.1.50/24 GW=192.168.1.1 MTERM_PASSWORD='tajna' bash proxmox-lxc.sh -y
```

Nadogradnja: `pct exec <CTID> -- mterm-update`

### 2. Docker

```bash
docker run -d --name mterm --restart unless-stopped -p 8080:8080 \
  -v mterm-data:/data -e MTERM_PASSWORD='promijeni-me' ghcr.io/moordrak/mterm:latest
```

ili `docker compose up -d` s priloženim [`docker-compose.yml`](docker-compose.yml).

### 3. Debian/Ubuntu (VM ili server)

```bash
curl -fsSL https://raw.githubusercontent.com/moordrak/MTerm/main/scripts/install.sh | sudo bash
```

### 4. Ručno

```bash
git clone https://github.com/moordrak/MTerm.git && cd MTerm
npm install --omit=dev
MTERM_PASSWORD='tajna' npm start
```

Otvorite `http://<server>:8080`.

## Konfiguracija

| Varijabla | Zadano | Opis |
|---|---|---|
| `PORT` | `8080` | port web sučelja |
| `HOST` | `0.0.0.0` | adresa na kojoj server sluša |
| `MTERM_USER` | `admin` | korisnik za prijavu u MTerm |
| `MTERM_PASSWORD` | *(prazno)* | lozinka; ako nije postavljena, MTerm **nije zaštićen** |
| `MTERM_SESSION_HOURS` | `12` | trajanje prijave |
| `MTERM_IDLE_MINUTES` | `30` | nakon koliko minuta neaktivnosti se zatvara sesija datoteka |
| `MTERM_SERVER_STORAGE` | `true` | dopušta spremanje veza i postavki na server |
| `MTERM_DATA_DIR` | `./data` (Docker: `/data`, LXC: `/var/lib/mterm`) | mapa za spremljene veze |
| `MTERM_SECRET` | *(automatski `secret.key`)* | ključ za šifriranje lozinaka spremljenih na serveru |

Kod LXC/systemd instalacije postavke su u `/etc/mterm/mterm.env` (`systemctl restart mterm` nakon izmjene).

### Iza nginx reverse proxyja

WebSocket mora biti propušten:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 1d;
    client_max_body_size 0;      # bez ograničenja veličine za slanje datoteka
    proxy_request_buffering off;
}
```

Za kopiranje/lijepljenje iz međuspremnika preglednik zahtijeva HTTPS.

## Sigurnost

- MTerm može otvoriti vezu prema bilo kojem hostu koji vidi server, pa ga **uvijek** zaštitite lozinkom
  (`MTERM_PASSWORD`) i ne izlažite ga internetu bez HTTPS-a/VPN-a.
- Lozinke za udaljene servere spremaju se samo ako uključite "Spremi lozinku/ključ" - u pregledniku
  (localStorage) ili, uz pohranu na serveru, u `store.json` šifrirane AES-256-GCM. Ključ je u `secret.key`
  u istoj mapi (ili `MTERM_SECRET`) - napravite sigurnosnu kopiju cijele mape, bez ključa se lozinke ne mogu pročitati.
- Pohrana na serveru vidljiva je svakome tko se može prijaviti u MTerm, pa je bez `MTERM_PASSWORD` ne koristite.
- Ključ SSH hosta se prihvaća automatski, a njegov SHA256 otisak se prikazuje u statusnoj traci/obavijesti.

## Razvoj

```bash
npm install
npm run check          # sintaksna provjera
npm start
node test/integration.mjs   # integracijski testovi (vidi .github/workflows/ci.yml)
```

Struktura:

```
public/            HTML sučelje (index.html, app.js, style.css, themes.js, backgrounds.js)
server/index.js    HTTP + WebSocket server, statičke datoteke, prijava
server/ssh.js      SSH terminal preko WebSocketa
server/files.js    API za datoteke i sesije
server/storage.js  spremanje veza i postavki na server (šifrirane lozinke)
server/adapters/   sftp.js, scp.js, ftp.js (FTP/FTPS), webdav.js
scripts/           install.sh, proxmox-lxc.sh
```

## Licenca

MIT
