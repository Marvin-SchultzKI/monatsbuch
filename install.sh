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
#   Erneut ausführen = Update. Die Daten in /var/www/monatsbuch/data bleiben erhalten.
set -euo pipefail

DOMAIN="${DOMAIN:-monatebuch.duckdns.org}"
APP_DIR="${APP_DIR:-/var/www/monatsbuch}"
SRC_TGZ="${SRC_TGZ:-https://codeload.github.com/Marvin-SchultzKI/monatsbuch/tar.gz/refs/heads/main}"
LOG=/root/monatsbuch-install.log
NAME=monatsbuch

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
. /etc/os-release; say "System:      $PRETTY_NAME"
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
if [ "$MODE" != apache ] && [ -f /etc/nginx/sites-available/$NAME.conf -o -f /etc/nginx/conf.d/$NAME.conf ]; then UPDATE=1; fi
if [ "$MODE" = apache ] && [ -f /etc/apache2/sites-available/$NAME.conf ]; then UPDATE=1; fi

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
else
  [ "$MODE" = nginx-neu ] && say "  • nginx installieren (Port 80/443 sind frei)"
  say "  • Pakete hinzufügen: php-fpm, php-sqlite3, php-mbstring, certbot"
  say "  • App nach $APP_DIR kopieren"
  say "  • Eigene Konfiguration nur für $DOMAIN anlegen (andere Seiten bleiben unberührt)"
  say "  • HTTPS-Zertifikat von Let's Encrypt für $DOMAIN"
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
ok "App liegt in $APP_DIR (Version $(grep -oE "APP_VERSION = '[^']+'" "$APP_DIR/lib.php" | cut -d"'" -f2))"

# ---------- 5. Webserver ----------
if [ $UPDATE -eq 0 ]; then
  if [ "$MODE" = apache ]; then
    CONF=/etc/apache2/sites-available/$NAME.conf
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
    a2ensite -q $NAME >>"$LOG" 2>&1
    if ! apache2ctl configtest >>"$LOG" 2>&1; then
      a2dissite -q $NAME >>"$LOG" 2>&1 || true; rm -f "$CONF"
      die "Apache-Konfiguration fehlerhaft – meine Datei wurde wieder entfernt, alles wie vorher."
    fi
    svc reload apache2
  else
    if [ -d /etc/nginx/sites-available ]; then CONF=/etc/nginx/sites-available/$NAME.conf; LINK=/etc/nginx/sites-enabled/$NAME.conf; else CONF=/etc/nginx/conf.d/$NAME.conf; LINK=""; fi
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

# ---------- 6. Prüfen ----------
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
say "Update später: denselben Befehl noch einmal ausführen."
say "Sicherung: Ordner $APP_DIR/data regelmäßig kopieren."
