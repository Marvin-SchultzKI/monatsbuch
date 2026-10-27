<?php
declare(strict_types=1);
require __DIR__ . '/lib.php';
start_session();
$name = htmlspecialchars(app_config()['app_name'], ENT_QUOTES);
$v = APP_VERSION;
header("Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
?><!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#0B6A86">
<title><?= $name ?></title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230B6A86'/%3E%3Cpath d='M8 22V10h3l5 7 5-7h3v12h-3v-7l-5 7-5-7v7z' fill='white'/%3E%3C/svg%3E">
<link rel="stylesheet" href="assets/app.css?v=<?= $v ?>">
</head>
<body>
<div id="app" data-app-name="<?= $name ?>">
  <div class="boot">Lädt …</div>
</div>
<noscript><p class="boot">Bitte JavaScript aktivieren.</p></noscript>
<script src="assets/chart.umd.js?v=4.4.1"></script>
<script src="assets/app.js?v=<?= $v ?>"></script>
</body>
</html>
