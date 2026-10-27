#!/usr/bin/env bash
# SM Monatsbuch – Installation und Update auf eigenem Server (Ubuntu/Debian).
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/Marvin-SchultzKI/monatsbuch/main/install.sh)
#
# Was das Skript tut:
#   1. Schaut nach, was auf dem Server läuft (Webserver, PHP, Domains) – ändert dabei nichts.
#   2. Zeigt den Plan und fragt nach. Erst nach „j“ wird etwas geändert.
#   3. Fügt NUR hinzu: PHP-FPM + SQLite, Ordner /var/www/monatsbuch, eine eigene
#      Webserver-Konfiguration für die Domain, ein HTTPS-Zertifikat.
#      Bestehende Webseiten und Konfigurationen werden nicht verändert.
#   4. Richtet automatische Updates (alle 10 Minuten) und eine tägliche Sicherung ein.
#   Erneut ausführen ist jederzeit möglich. Die Daten in /var/www/monatsbuch/data bleiben erhalten.
set -euo pipefail

DOMAIN="${DOMAIN:-monatebuch.duckdns.org}"
APP_DIR="${APP_DIR:-/var/www/monatsbuch}"
SRC_TGZ="${SRC_TGZ:-https://codeload.github.com/Marvin-SchultzKI/monatsbuch/tar.gz/refs/heads/main}"
LOG=/root/monatsbuch-install.log
APPNAME=monatsbuch

B=$'\e[1m'; R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; N=$'\e[0m'
say()  { echo "$*" | tee -a "$LOG"; }
ok()   { say "${G}✔${N} $*"; }
warn() { say "${Y}!${N} $*"; }
die()  { say "${R}✘ $*${N}"; say "Es wurde abgebrochen. Mach bitte ein Foto/Screenshot von dieser Ausgabe."; exit 1; }
svc()  { # Dienst neu laden/starten, auch ohne systemd
  local action=$1 name=$2
  if [ -d /run/systemd/system ]; then systemctl "$action" "$name"; else service "$name" "$action" >/dev/null 2>&1 || true; fi
}

[ "$(id -u)" -eq 0 ] || die "Bitte als root ausführen."
case "$APP_DIR" in /var/www/?*|/srv/?*) ;; *) die "APP_DIR muss unter /var/www/ oder /srv/ liegen.";; esac
: > "$LOG"
say "${B}SM Monatsbuch – Installation für $DOMAIN${N}"
say "Protokoll: $LOG"
say ""

# ---------- 1. Bestandsaufnahme (nur lesen) ----------
command -v apt-get >/dev/null || die "Nur Ubuntu/Debian wird unterstützt."
OSNAME=$( . /etc/os-release 2>/dev/null; echo "${PRETTY_NAME:-unbekannt}" ); say "System:      $OSNAME"
[ -d /usr/local/psa ] && die "Plesk ist installiert. Dann bitte die App über Plesk einrichten, nicht mit diesem Skript."

LISTEN=$(ss -tlnpH 2>/dev/null | awk '$4 ~ /:(80|443)$/ {print $6}' | sed -E 's/users:\(\("([^"]+)".*/\1/' | sort -u | tr '\n' ' ')
say "Port 80/443: ${LISTEN:-frei}"

MODE=""
case " $LISTEN " in
  *" nginx "*)                      MODE=nginx ;;
  *" apache2 "*|*" httpd "*)        MODE=apache ;;
  "  ")                             MODE=nginx-neu ;;
  *)                                MODE=unbekannt ;;
esac
[ "$MODE" = unbekannt ] && die "Auf Port 80/443 läuft ${LISTEN}– das richte ich nicht automatisch ein (z. B. Docker, Caddy, Traefik). Schick mir die Ausgabe."

PHPV=""; command -v php >/dev/null && PHPV=$(php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;')
say "PHP:         ${PHPV:-nicht installiert}"
say "Webserver:   $MODE"

UPDATE=0
if [ "$MODE" != apache ] && [ -f /etc/nginx/sites-available/$APPNAME.conf -o -f /etc/nginx/conf.d/$APPNAME.conf ]; then UPDATE=1; fi
if [ "$MODE" = apache ] && [ -f /etc/apache2/sites-available/$APPNAME.conf ]; then UPDATE=1; fi

if [ $UPDATE -eq 0 ]; then
  if [ "$MODE" = nginx ] && nginx -T 2>/dev/null | grep -E "^\s*server_name\b" | grep -qw "$DOMAIN"; then
    die "$DOMAIN ist im nginx schon für eine andere Seite eingetragen."
  fi
  if [ "$MODE" = apache ] && apache2ctl -S 2>/dev/null | grep -qw "$DOMAIN"; then
    die "$DOMAIN ist im Apache schon für eine andere Seite eingetragen."
  fi
fi

DIP=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)
MYIP=$(curl -s4 --max-time 8 https://api.ipify.org || true)
if [ -n "$DIP" ] && { [ "$DIP" = "$MYIP" ] || hostname -I | tr ' ' '\n' | grep -qx "$DIP"; }; then
  ok "$DOMAIN zeigt auf diesen Server ($DIP)"; DNS_OK=1
else
  warn "$DOMAIN zeigt auf ${DIP:-nichts}, dieser Server ist ${MYIP:-unbekannt}. HTTPS klappt erst, wenn das stimmt."; DNS_OK=0
fi
[ -d "$APP_DIR/data" ] && ok "Vorhandene Daten in $APP_DIR/data werden behalten"

# ---------- 2. Plan zeigen und nachfragen ----------
say ""
say "${B}Geplant:${N}"
if [ $UPDATE -eq 1 ]; then
  say "  • App-Dateien in $APP_DIR aktualisieren (data/ bleibt unverändert)"
  say "  • Automatische Updates und tägliche Sicherung einrichten"
else
  [ "$MODE" = nginx-neu ] && say "  • nginx installieren (Port 80/443 sind frei)"
  say "  • Pakete hinzufügen: php-fpm, php-sqlite3, php-mbstring, certbot"
  say "  • App nach $APP_DIR kopieren"
  say "  • Eigene Konfiguration nur für $DOMAIN anlegen (andere Seiten bleiben unberührt)"
  say "  • HTTPS-Zertifikat von Let's Encrypt für $DOMAIN"
  say "  • Automatische Updates und tägliche Sicherung einrichten"
fi
say ""
if [ "${YES:-}" != 1 ]; then
  read -r -p "Fortfahren? (j/n) " ans < /dev/tty || ans=n
  [[ "$ans" =~ ^[jJyY] ]] || { say "Nichts geändert."; exit 0; }
fi

# ---------- 3. Pakete ----------
export DEBIAN_FRONTEND=noninteractive
if [ $UPDATE -eq 0 ]; then
  say "Installiere Pakete …"
  apt-get update -qq >>"$LOG" 2>&1
  PKGS="php-fpm php-sqlite3 php-mbstring curl ca-certificates certbot"
  [ "$MODE" = nginx-neu ] && PKGS="$PKGS nginx"
  [ "$MODE" = nginx ] || [ "$MODE" = nginx-neu ] && PKGS="$PKGS python3-certbot-nginx"
  [ "$MODE" = apache ] && PKGS="$PKGS python3-certbot-apache"
  apt-get install -y -qq $PKGS >>"$LOG" 2>&1 || die "Paketinstallation fehlgeschlagen (Details in $LOG)."
  ok "Pakete installiert"
fi
PHPV=$(php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;')
SOCK=/run/php/php${PHPV}-fpm.sock
svc start "php${PHPV}-fpm" || true
php -m | grep -qi pdo_sqlite || die "PHP-Erweiterung pdo_sqlite fehlt."

# ---------- 4. App-Dateien ----------
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
say "Lade App …"
if [ -f "$SRC_TGZ" ]; then cp "$SRC_TGZ" "$TMP/app.tgz"; else curl -fsSL "$SRC_TGZ" -o "$TMP/app.tgz" || die "Download fehlgeschlagen."; fi
tar -xzf "$TMP/app.tgz" -C "$TMP"
SRC=$(find "$TMP" -mindepth 2 -maxdepth 2 -type d -name app | head -1)
[ -n "$SRC" ] && [ -f "$SRC/index.php" ] || die "App-Dateien im Download nicht gefunden."
mkdir -p "$APP_DIR"
# alles außer data/ ersetzen
find "$APP_DIR" -mindepth 1 -maxdepth 1 ! -name data -exec rm -rf {} +
( cd "$SRC" && find . -mindepth 1 -maxdepth 1 ! -name data -exec cp -a {} "$APP_DIR"/ \; )
mkdir -p "$APP_DIR/data"
[ -f "$APP_DIR/data/.htaccess" ] || cp "$SRC/data/.htaccess" "$APP_DIR/data/.htaccess" 2>/dev/null || true
chown -R root:root "$APP_DIR"; find "$APP_DIR" -type d -exec chmod 755 {} +; find "$APP_DIR" -type f -exec chmod 644 {} +
chown -R www-data:www-data "$APP_DIR/data"; chmod 750 "$APP_DIR/data"
svc reload "php${PHPV}-fpm" 2>/dev/null || true
ok "App liegt in $APP_DIR (Version $(grep -oE "APP_VERSION = '[^']+'" "$APP_DIR/lib.php" | cut -d"'" -f2))"

# ---------- 5. Webserver ----------
if [ $UPDATE -eq 0 ]; then
  if [ "$MODE" = apache ]; then
    CONF=/etc/apache2/sites-available/$APPNAME.conf
    cat > "$CONF" <<EOF
# SM Monatsbuch – angelegt von install.sh
<VirtualHost *:80>
    ServerName $DOMAIN
    DocumentRoot $APP_DIR
    <Directory $APP_DIR>
        Options -Indexes
        AllowOverride All
        Require all granted
    </Directory>
    <FilesMatch "\.php$">
        SetHandler "proxy:unix:$SOCK|fcgi://localhost"
    </FilesMatch>
</VirtualHost>
EOF
    a2enmod -q proxy_fcgi setenvif rewrite headers >>"$LOG" 2>&1
    a2ensite -q $APPNAME >>"$LOG" 2>&1
    if ! apache2ctl configtest >>"$LOG" 2>&1; then
      a2dissite -q $APPNAME >>"$LOG" 2>&1 || true; rm -f "$CONF"
      die "Apache-Konfiguration fehlerhaft – meine Datei wurde wieder entfernt, alles wie vorher."
    fi
    svc reload apache2
  else
    if [ -d /etc/nginx/sites-available ]; then CONF=/etc/nginx/sites-available/$APPNAME.conf; LINK=/etc/nginx/sites-enabled/$APPNAME.conf; else CONF=/etc/nginx/conf.d/$APPNAME.conf; LINK=""; fi
    V6=""; [ -s /proc/net/if_inet6 ] && V6="listen [::]:80;"
    cat > "$CONF" <<EOF
# SM Monatsbuch – angelegt von install.sh
server {
    listen 80;
    $V6
    server_name $DOMAIN;
    root $APP_DIR;
    index index.php;
    client_max_body_size 2m;
    server_tokens off;

    location ^~ /data/ { return 404; }
    location ~ /\. { return 404; }
    location ~ ^/(lib|config)\.php\$ { return 404; }
    location ~ \.(sqlite|md)\$ { return 404; }

    location / { try_files \$uri \$uri/ /index.php; }
    location ~ \.php\$ {
        try_files \$uri =404;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME \$document_root\$fastcgi_script_name;
        fastcgi_param HTTPS \$https if_not_empty;
        fastcgi_pass unix:$SOCK;
    }
    location ~* \.(js|css|woff2)\$ { expires 7d; add_header Cache-Control "public"; }
}
EOF
    [ -n "$LINK" ] && ln -sf "$CONF" "$LINK"
    if ! nginx -t >>"$LOG" 2>&1; then
      rm -f "$CONF" ${LINK:+"$LINK"}
      die "nginx-Konfiguration fehlerhaft – meine Datei wurde wieder entfernt, alles wie vorher."
    fi
    if [ "$MODE" = nginx-neu ]; then svc enable nginx >/dev/null 2>&1 || true; svc start nginx; fi
    svc reload nginx
  fi
  ok "Webserver eingerichtet für $DOMAIN"

  if [ "$DNS_OK" = 1 ]; then
    say "Hole HTTPS-Zertifikat …"
    PLUG=nginx; [ "$MODE" = apache ] && PLUG=apache
    if certbot --$PLUG -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect >>"$LOG" 2>&1; then
      ok "HTTPS aktiv"
    else
      warn "Zertifikat fehlgeschlagen (Details in $LOG). Die App läuft vorerst über http://"
    fi
  else
    warn "HTTPS übersprungen, weil die Domain nicht auf diesen Server zeigt."
  fi
fi

# ---------- 6. Automatische Updates und tägliche Sicherung ----------
REPO="${REPO:-Marvin-SchultzKI/monatsbuch}"
mkdir -p /var/lib/monatsbuch /var/backups/monatsbuch
chmod 700 /var/backups/monatsbuch
cat > /etc/monatsbuch.env <<EOF
DOMAIN=$DOMAIN
APP_DIR=$APP_DIR
REPO=$REPO
PHPV=$PHPV
EOF

cat > /usr/local/sbin/monatsbuch-update <<'EOS'
#!/usr/bin/env bash
# Holt neue App-Versionen aus GitHub. Nur App-Dateien, nie data/.
# Prüft PHP-Syntax vorher und die App nachher; bei Problemen zurück zur alten Version.
set -euo pipefail
. /etc/monatsbuch.env
STATE=/var/lib/monatsbuch
log() { echo "$*"; command -v logger >/dev/null && logger -t monatsbuch-update "$*" || true; }
reload_php() { # PHP-Zwischenspeicher (OPcache) leeren, sonst laufen noch alte Dateien
  systemctl reload "php${PHPV}-fpm" 2>/dev/null || service "php${PHPV}-fpm" reload >/dev/null 2>&1 || true
  sleep 2
}
health() { # $1 = erwartete Version
  local r
  r=$(curl -sk --max-time 15 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api.php?action=state" 2>/dev/null || true)
  echo "$r" | grep -q '"csrf"' || r=$(curl -s --max-time 15 -H "Host: $DOMAIN" "http://127.0.0.1/api.php?action=state" 2>/dev/null || true)
  echo "$r" | grep -q '"csrf"' && echo "$r" | grep -qF "\"version\":\"$1\""
}
if [ -n "${SRC_TGZ:-}" ]; then SHA="lokal-$(sha256sum "$SRC_TGZ" | cut -c1-12)"; else
  SHA=$(curl -fsS --max-time 20 -H 'Accept: application/vnd.github.sha' "https://api.github.com/repos/$REPO/commits/main" || true)
  [[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { log "GitHub nicht erreichbar, nächster Versuch später"; exit 0; }
fi
[ "$(cat $STATE/deployed 2>/dev/null)" = "$SHA" ] && [ "${FORCE:-}" != 1 ] && exit 0
[ "$(cat $STATE/failed 2>/dev/null)" = "$SHA" ] && [ "${FORCE:-}" != 1 ] && exit 0
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
if [ -n "${SRC_TGZ:-}" ]; then cp "$SRC_TGZ" "$TMP/a.tgz"; else curl -fsSL --max-time 60 "https://codeload.github.com/$REPO/tar.gz/$SHA" -o "$TMP/a.tgz"; fi
tar -xzf "$TMP/a.tgz" -C "$TMP"
SRC=$(find "$TMP" -mindepth 2 -maxdepth 2 -type d -name app | head -1)
[ -n "$SRC" ] && [ -f "$SRC/index.php" ] || { log "Download unvollständig – Update übersprungen"; exit 1; }
while IFS= read -r -d '' f; do php -l "$f" >/dev/null 2>&1 || { echo "$SHA" > "$STATE/failed"; log "PHP-Fehler in ${f#$SRC/} – Update übersprungen"; exit 1; }; done < <(find "$SRC" -name '*.php' -print0)
# alte Version sichern
rm -rf "$STATE/prev"; mkdir -p "$STATE/prev"
( cd "$APP_DIR" && find . -mindepth 1 -maxdepth 1 ! -name data -exec cp -a {} "$STATE/prev/" \; )
deploy() { # $1 = Quelle
  find "$APP_DIR" -mindepth 1 -maxdepth 1 ! -name data -exec rm -rf {} +
  ( cd "$1" && find . -mindepth 1 -maxdepth 1 ! -name data -exec cp -a {} "$APP_DIR"/ \; )
  chown -R root:root "$APP_DIR"; find "$APP_DIR" -path "$APP_DIR/data" -prune -o -type d -exec chmod 755 {} + ; find "$APP_DIR" -path "$APP_DIR/data" -prune -o -type f -exec chmod 644 {} +
  chown -R www-data:www-data "$APP_DIR/data"; chmod 750 "$APP_DIR/data"
}
NEWV=$(grep -oE "APP_VERSION = '[^']+'" "$SRC/lib.php" | cut -d"'" -f2)
deploy "$SRC"
reload_php
if health "$NEWV"; then
  echo "$SHA" > "$STATE/deployed"
  log "Update auf ${SHA:0:7} installiert ($(grep -oE "APP_VERSION = '[^']+'" "$APP_DIR/lib.php" | cut -d"'" -f2))"
else
  deploy "$STATE/prev"
  reload_php
  echo "$SHA" > "$STATE/failed"
  log "Neue Version ${SHA:0:7} antwortet nicht – alte Version wiederhergestellt"
  exit 1
fi
EOS
chmod 755 /usr/local/sbin/monatsbuch-update

cat > /usr/local/sbin/monatsbuch-backup <<'EOS'
#!/usr/bin/env bash
# Tägliche Sicherung der Datenbank, 30 Tage aufbewahrt.
set -euo pipefail
. /etc/monatsbuch.env
DEST=/var/backups/monatsbuch
CFG="$APP_DIR/data/config.local.php"
[ -f "$CFG" ] || { echo "Noch keine Datenbank – nichts zu sichern"; exit 0; }
F="$DEST/monatsbuch-$(date +%F_%H%M).sqlite"
php -r '$c = require $argv[1]; $db = new PDO("sqlite:" . $c["db_path"]); $db->exec("VACUUM INTO " . $db->quote($argv[2])); $t = new PDO("sqlite:" . $argv[2]); $ok = $t->query("PRAGMA integrity_check")->fetchColumn(); if ($ok !== "ok") { fwrite(STDERR, "Prüfung fehlgeschlagen\n"); exit(1); }' "$CFG" "$F"
cp "$CFG" "$DEST/config.local.php"
gzip -f "$F"
chmod 600 "$F.gz"
find "$DEST" -name 'monatsbuch-*.sqlite.gz' -mtime +30 -delete
echo "Sicherung: $F.gz"
command -v logger >/dev/null && logger -t monatsbuch-backup "Sicherung $F.gz erstellt" || true
EOS
chmod 755 /usr/local/sbin/monatsbuch-backup

if [ -d /run/systemd/system ]; then
  cat > /etc/systemd/system/monatsbuch-update.service <<'EOF'
[Unit]
Description=SM Monatsbuch – nach neuer Version suchen
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/monatsbuch-update
EOF
  cat > /etc/systemd/system/monatsbuch-update.timer <<'EOF'
[Unit]
Description=SM Monatsbuch – alle 10 Minuten nach Updates suchen
[Timer]
OnBootSec=3min
OnUnitActiveSec=10min
RandomizedDelaySec=60
[Install]
WantedBy=timers.target
EOF
  cat > /etc/systemd/system/monatsbuch-backup.service <<'EOF'
[Unit]
Description=SM Monatsbuch – Sicherung der Datenbank
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/monatsbuch-backup
EOF
  cat > /etc/systemd/system/monatsbuch-backup.timer <<'EOF'
[Unit]
Description=SM Monatsbuch – tägliche Sicherung um 3:30 Uhr
[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true
[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now monatsbuch-update.timer monatsbuch-backup.timer >>"$LOG" 2>&1
else
  cat > /etc/cron.d/monatsbuch <<'EOF'
*/10 * * * * root /usr/local/sbin/monatsbuch-update >/dev/null 2>&1
30 3 * * * root /usr/local/sbin/monatsbuch-backup >/dev/null 2>&1
EOF
fi
# aktuellen Stand als installiert merken
CUR=$(curl -fsS --max-time 20 -H 'Accept: application/vnd.github.sha' "https://api.github.com/repos/$REPO/commits/main" 2>/dev/null || true)
[[ "$CUR" =~ ^[0-9a-f]{40}$ ]] && [ ! -f "$SRC_TGZ" ] && echo "$CUR" > /var/lib/monatsbuch/deployed
ok "Automatische Updates aktiv (alle 10 Minuten)"
if /usr/local/sbin/monatsbuch-backup >>"$LOG" 2>&1; then ok "Tägliche Sicherung aktiv (3:30 Uhr, 30 Tage) – erste Sicherung erstellt"; else warn "Sicherung eingerichtet, erster Lauf fehlgeschlagen (Details in $LOG)"; fi

# ---------- 7. Prüfen ----------
sleep 1
RESP=$(curl -s --max-time 10 -H "Host: $DOMAIN" "http://127.0.0.1/api.php?action=state" || true)
if echo "$RESP" | grep -q '"csrf"'; then ok "App antwortet"; else
  RESP=$(curl -sk --max-time 10 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api.php?action=state" || true)
  echo "$RESP" | grep -q '"csrf"' && ok "App antwortet" || warn "App antwortet nicht wie erwartet: ${RESP:0:120}"
fi
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H "Host: $DOMAIN" "http://127.0.0.1/data/config.local.php" || true)
if [ "$CODE" = 301 ] || [ "$CODE" = 308 ]; then
  CODE=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/data/config.local.php" || true)
fi
if [ "$CODE" = 404 ] || [ "$CODE" = 403 ]; then ok "Datenordner von außen gesperrt"; else warn "Datenordner liefert HTTP $CODE – bitte melden"; fi

say ""
say "${B}${G}Fertig.${N} Öffne jetzt: ${B}https://$DOMAIN/${N}"
[ $UPDATE -eq 0 ] && say "Beim ersten Aufruf legst du dein Admin-Konto an."
say "Updates kommen ab jetzt automatisch (alle 10 Minuten geprüft)."
say "Sicherungen: /var/backups/monatsbuch – zusätzlich in der App: Menü → Sicherung herunterladen."
