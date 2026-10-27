<?php
// Gemeinsame Funktionen: Konfiguration, Datenbank, Sitzung, Anmeldung.
declare(strict_types=1);

if (PHP_VERSION_ID < 80000) {
    http_response_code(500);
    exit('Monatsbuch braucht PHP 8.0 oder neuer. Bitte im netcup-Kundenbereich die PHP-Version umstellen.');
}

const APP_VERSION = '1.1.0';
const FIELDS = ['c', 'cb', 'w', 'wb', 's', 'sb', 'k', 'kb'];

function app_config(): array
{
    static $cfg = null;
    if ($cfg !== null) return $cfg;
    $cfg = require __DIR__ . '/config.php';
    $local = __DIR__ . '/data/config.local.php';
    if (is_file($local)) {
        $cfg = array_merge($cfg, require $local);
    }
    return $cfg;
}

/** Legt beim ersten Start den Datenordner mit Schutz und zufälligem Dateinamen an. */
function db_path(): string
{
    $cfg = app_config();
    if (!empty($cfg['db_path'])) return $cfg['db_path'];
    $dir = __DIR__ . '/data';
    if (!is_dir($dir) && !@mkdir($dir, 0700, true)) {
        fail_setup('Der Ordner „data“ konnte nicht angelegt werden. Bitte Schreibrechte prüfen.');
    }
    if (!is_writable($dir)) {
        fail_setup('Der Ordner „data“ ist nicht beschreibbar. Bitte im FTP-Programm Schreibrechte (755 oder 775) setzen.');
    }
    if (!is_file("$dir/.htaccess")) {
        @file_put_contents("$dir/.htaccess", "<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n  Deny from all\n</IfModule>\n");
    }
    if (!is_file("$dir/index.html")) {
        @file_put_contents("$dir/index.html", '');
    }
    $path = $dir . '/mb_' . bin2hex(random_bytes(12)) . '.sqlite';
    $php = "<?php\n// Automatisch erzeugt. Nicht löschen, sonst findet die App ihre Daten nicht mehr.\nreturn ['db_path' => " . var_export($path, true) . "];\n";
    if (@file_put_contents("$dir/config.local.php", $php) === false) {
        fail_setup('Die Datei data/config.local.php konnte nicht geschrieben werden.');
    }
    return $path;
}

function fail_setup(string $msg): void
{
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo) return $pdo;
    $pdo = new PDO('sqlite:' . db_path(), null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('PRAGMA busy_timeout = 5000');
    migrate($pdo);
    return $pdo;
}

function migrate(PDO $pdo): void
{
    $pdo->exec('CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name TEXT NOT NULL,
        pass_hash TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
    )');
    $pdo->exec('CREATE TABLE IF NOT EXISTS entries (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        c REAL NOT NULL DEFAULT 0, cb REAL NOT NULL DEFAULT 0,
        w REAL NOT NULL DEFAULT 0, wb REAL NOT NULL DEFAULT 0,
        s REAL NOT NULL DEFAULT 0, sb REAL NOT NULL DEFAULT 0,
        k REAL NOT NULL DEFAULT 0, kb REAL NOT NULL DEFAULT 0,
        manuell REAL NOT NULL DEFAULT 0,
        info TEXT NOT NULL DEFAULT \'\',
        status TEXT NOT NULL DEFAULT \'\',
        teil REAL NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, day)
    )');
    $pdo->exec('CREATE TABLE IF NOT EXISTS prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        valid_from TEXT NOT NULL,
        c REAL NULL, w REAL NULL, s REAL NULL, k REAL NULL,
        cb REAL NULL, wb REAL NULL, sb REAL NULL, kb REAL NULL,
        UNIQUE (user_id, valid_from)
    )');
    $pdo->exec('CREATE TABLE IF NOT EXISTS login_attempts (
        key TEXT NOT NULL,
        ts INTEGER NOT NULL
    )');
}

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    session_name(app_config()['session_name']);
    session_set_cookie_params([
        'lifetime' => 60 * 60 * 24 * 30,
        'path' => dirname($_SERVER['SCRIPT_NAME']) === '/' ? '/' : rtrim(dirname($_SERVER['SCRIPT_NAME']), '/') . '/',
        'secure' => $https,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    ini_set('session.gc_maxlifetime', (string)(60 * 60 * 24 * 30));
    session_start();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
}

function csrf_token(): string
{
    start_session();
    return $_SESSION['csrf'];
}

function current_user(): ?array
{
    start_session();
    $id = $_SESSION['uid'] ?? null;
    if (!$id) return null;
    $st = db()->prepare('SELECT id, username, display_name, is_admin FROM users WHERE id = ?');
    $st->execute([$id]);
    $u = $st->fetch();
    if (!$u) {
        unset($_SESSION['uid']);
        return null;
    }
    return $u;
}

function user_public(array $u): array
{
    return [
        'id' => (int)$u['id'],
        'username' => $u['username'],
        'name' => $u['display_name'],
        'isAdmin' => (bool)$u['is_admin'],
    ];
}

/** Bremst Passwort-Raten: höchstens 8 Fehlversuche je 15 Minuten pro Benutzername und IP. */
function too_many_attempts(string $username): bool
{
    $pdo = db();
    $since = time() - 15 * 60;
    $pdo->prepare('DELETE FROM login_attempts WHERE ts < ?')->execute([time() - 24 * 3600]);
    $ip = $_SERVER['REMOTE_ADDR'] ?? '?';
    $st = $pdo->prepare('SELECT COUNT(*) FROM login_attempts WHERE (key = ? OR key = ?) AND ts >= ?');
    $st->execute(['u:' . mb_strtolower($username), 'ip:' . $ip, $since]);
    return (int)$st->fetchColumn() >= 8;
}

function record_failed_attempt(string $username): void
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '?';
    $st = db()->prepare('INSERT INTO login_attempts (key, ts) VALUES (?, ?)');
    $st->execute(['u:' . mb_strtolower($username), time()]);
    $st->execute(['ip:' . $ip, time()]);
}

function json_out($data, int $code = 200): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(string $msg, int $code = 400): void
{
    json_out(['error' => $msg], $code);
}

function now_iso(): string
{
    return gmdate('Y-m-d\TH:i:s\Z');
}
