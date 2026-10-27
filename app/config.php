<?php
// Grundeinstellungen. Die Datenbank legt die App beim ersten Aufruf selbst an
// (Ordner data/, Pfad steht danach in data/config.local.php).
return [
    'app_name' => 'SM Monatsbuch',
    'session_name' => 'smmonatsbuch',
    // Optional: eigener Pfad zur Datenbank, am besten außerhalb des Webordners,
    // z. B. '/var/www/vhosts/deine-domain.de/monatsbuch-daten/daten.sqlite'
    'db_path' => null,
];
