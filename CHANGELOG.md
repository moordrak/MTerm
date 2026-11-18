# Promjene

## v1.4.0 (2026-11-18)

### Novo
- **Preuzimanje cijelih mapa** kao ZIP: označite mapu (ili više stavki) i kliknite ⤓ Preuzmi.
  Bez oznake se nudi preuzimanje cijele trenutne mape. ZIP se slaže u hodu na serveru (bez privremenih
  datoteka), podržava datoteke veće od 4 GB (ZIP64), čuva prazne mape i hrvatske znakove u imenima.
  Stavke koje se ne mogu pročitati navode se u `_MTERM_GRESKE.txt` unutar ZIP-a.
- **Podijeljeni prikaz** (gumb ⇆ Lokalno): lijevo mape na ovom računalu, desno na serveru.
  - kopiranje u oba smjera gumbima *Na server ⇒* / *⇐ U lokalnu*, dvoklikom ili povlačenjem redova
  - cijele mape s podmapama u oba smjera, s napretkom i prekidom
  - nova lokalna mapa i brisanje lokalnih stavki
  - širina se mijenja povlačenjem razdjelnika, a odabrana lokalna mapa se pamti
  - zahtijeva Chrome ili Edge i HTTPS (ili localhost); u ostalim slučajevima prikazuje se uputa

## v1.3.0 (2026-11-18)

### Novo
- **Slanje cijelih mapa** s podmapama:
  - gumb **⤒ Pošalji mapu** u upravitelju datoteka
  - ili povucite mapu (ili više njih) iz Explorera/Findera u prozor - sačuvaju se i prazne podmape
  - na serveru se automatski kreira cijela struktura mapa (postojeće mape se koriste)
  - jedan red napretka za cijelu mapu (broj datoteka, ukupna veličina, trenutna datoteka) i gumb ✕ za prekid
  - ako neka datoteka ne uspije, ostale se i dalje šalju, a na kraju se prikaže popis grešaka
- Radi za SFTP, SCP, FTP, FTPS i WebDAV.

## v1.2.0 (2026-11-18)

### Novo
- **Skrivanje bočnog izbornika** (Postavke → Bočni izbornik):
  - *Prikazan* - kao do sada; gumb « u izborniku ga sakriva
  - *Skriven* - izbornik se otvara gumbom ☰ (gore lijevo) ili s **Ctrl+Shift+B**, klik izvan njega ga zatvara
  - *Automatski* - izbornik se pojavi kad miš dođe do lijevog ruba ekrana i nestane kad ga napusti
  - 📌 ponovno prikvači izbornik
- Terminal i upravitelj datoteka automatski koriste oslobođeni prostor.

### Ispravci
- `install.sh` prihvaća `MTERM_VERSION=main` za instalaciju izravno s glavne grane.

## v1.1.0 (2026-11-18)

### Novo
- **Spremanje veza i postavki na server** (Postavke → Pohrana): iste veze na svim uređajima.
  Lozinke i ključevi se na serveru šifriraju (AES-256-GCM), a spremaju se samo ako je uključeno „Spremi lozinku/ključ”.
  Postojeće veze iz preglednika automatski se prenose na server.
- **20 tema terminala**: Dracula, Nord, Monokai, Gruvbox, One Dark, Tokyo Night, Catppuccin Mocha, Rosé Pine,
  Synthwave '84, GitHub (tamna/svijetla), Solarized (tamna/svijetla), Ubuntu, PowerShell, Matrix, Jantar i druge.
  Sučelje se automatski usklađuje s bojama teme, a akcentnu boju možete sami odabrati.
- **Dinamičke pozadine**: gradijent, aurora, Matrix kiša, svemir, mreža čestica, valovi, mjehurići, snijeg,
  retro mreža i vlastita slika (URL) s polaganim pomicanjem. Brzina animacije je podesiva.
- **Prozirnost** terminala i sučelja te zamućenje pozadine (stakleni efekt).
- Izbor oblika kursora, gumb „Zadano” i trenutni pregled promjena u postavkama.

### Instalacija / nadogradnja
- Docker: podaci u volumenu `/data` (`-v mterm-data:/data`).
- LXC/systemd: podaci u `/var/lib/mterm`; nadogradnja s `pct exec <CTID> -- mterm-update`.

## v1.0.0 (2026-11-18)

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
