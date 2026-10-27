# SM Monatsbuch

Tagesbuch für C / W / S / K und Bons mit Woche, Monat, Auswertung, offenen Posten,
Preisliste „gültig ab“ und mehreren Benutzern (jeder mit eigener Tabelle).
PHP 8 + SQLite, keine externen Dienste.

## Installation auf eigenem Server (Ubuntu/Debian, als root)

```
bash <(curl -fsSL https://raw.githubusercontent.com/Marvin-SchultzKI/monatsbuch/main/install.sh)
```

Das Skript zeigt zuerst, was es vorhat, und fragt nach. Es fügt nur hinzu
(PHP-FPM, SQLite, Ordner `/var/www/monatsbuch`, eigene Webserver-Konfiguration für die
Domain, HTTPS-Zertifikat) und lässt bestehende Webseiten unverändert.
Erneut ausführen = Update, die Daten in `/var/www/monatsbuch/data` bleiben erhalten.

Andere Domain: `DOMAIN=meine.domain.de bash <(curl -fsSL …/install.sh)`
