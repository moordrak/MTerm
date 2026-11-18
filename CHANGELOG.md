# Promjene


Prvo izdanje: web terminal i upravitelj datoteka u pregledniku.

### Mogućnosti
- **SSH terminal** (xterm.js): više tabova, 256 boja, promjena veličine, kopiraj/zalijepi (Ctrl+Shift+C/V), teme
- **Upravitelj datoteka**: **SFTP, SCP, FTP, FTPS** (eksplicitni/implicitni), **WebDAV / WebDAVS**
  - pregled, slanje (povuci-i-ispusti, napredak), preuzimanje, preimenovanje, brisanje, nove mape
- Spremljene veze s grupama, pretraživanjem te izvozom/uvozom
- Prijava lozinkom ili SSH ključem, podrška za self-signed TLS
- Zaštita MTerma korisnikom i lozinkom (`MTERM_PASSWORD`)

### Instalacija

**Proxmox LXC** (na Proxmox hostu):
```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/moordrak/MTerm/main/scripts/proxmox-lxc.sh)"
```

**Docker** (amd64 / arm64):
```bash
docker run -d --name mterm --restart unless-stopped -p 8080:8080 \
  -e MTERM_PASSWORD='promijeni-me' ghcr.io/moordrak/mterm:1.0.0
```

**Debian/Ubuntu**:
```bash
curl -fsSL https://raw.githubusercontent.com/moordrak/MTerm/main/scripts/install.sh | sudo bash
```

Sve protokole testiraju integracijski testovi u CI-ju na stvarnim serverima (OpenSSH, Pure-FTPd s TLS-om, WebDAV).
