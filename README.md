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
Danach kommen Updates automatisch: Der Server prüft alle 10 Minuten auf eine neue Version,
testet sie und rollt bei Problemen selbst zurück. Jede Nacht um 3:30 Uhr wird die
Datenbank nach `/var/backups/monatsbuch` gesichert (30 Tage). Erneut ausführen ist
jederzeit möglich, die Daten in `/var/www/monatsbuch/data` bleiben erhalten.

Andere Domain: `DOMAIN=meine.domain.de bash <(curl -fsSL …/install.sh)`
