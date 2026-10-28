<?php
// JSON-Schnittstelle für die App. Alle Schreibzugriffe brauchen Anmeldung und CSRF-Token.
declare(strict_types=1);
require __DIR__ . '/lib.php';

header('X-Content-Type-Options: nosniff');
start_session();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$in = [];
if ($method === 'POST') {
    $raw = file_get_contents('php://input') ?: '';
    $in = json_decode($raw, true);
    if (!is_array($in)) fail('Ungültige Anfrage.');
    if (!hash_equals(csrf_token(), (string)($_SERVER['HTTP_X_CSRF'] ?? ''))) {
        fail('Sitzung abgelaufen. Bitte Seite neu laden.', 403);
    }
}

try {
    route($method, $action, $in);
} catch (PDOException $e) {
    error_log('Monatsbuch DB: ' . $e->getMessage());
    fail('Datenbankfehler. Bitte erneut versuchen.', 500);
}

function route(string $method, string $action, array $in): void
{
    $pdo = db();
    $userCount = (int)$pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();

    if ($method === 'GET' && $action === 'state') {
        $u = current_user();
        json_out([
            'needSetup' => $userCount === 0,
            'user' => $u ? user_public($u) : null,
            'csrf' => csrf_token(),
            'version' => APP_VERSION,
        ]);
    }

    if ($method === 'POST' && $action === 'setup') {
        if ($userCount > 0) fail('Die App ist schon eingerichtet.', 403);
        $id = create_user($in['username'] ?? '', $in['name'] ?? '', $in['password'] ?? '', true);
        session_regenerate_id(true);
        $_SESSION['uid'] = $id;
        json_out(['ok' => true]);
    }

    if ($method === 'POST' && $action === 'login') {
        $username = trim((string)($in['username'] ?? ''));
        if (too_many_attempts($username)) fail('Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.', 429);
        $st = $pdo->prepare('SELECT * FROM users WHERE username = ?');
        $st->execute([$username]);
        $u = $st->fetch();
        if (!$u || !password_verify((string)($in['password'] ?? ''), $u['pass_hash'])) {
            record_failed_attempt($username);
            fail('Benutzername oder Passwort falsch.', 401);
        }
        session_regenerate_id(true);
        $_SESSION['uid'] = (int)$u['id'];
        json_out(['ok' => true]);
    }

    if ($method === 'POST' && $action === 'logout') {
        $_SESSION = [];
        session_destroy();
        json_out(['ok' => true]);
    }

    // Ab hier nur angemeldet
    $me = current_user();
    if (!$me) fail('Bitte anmelden.', 401);
    $isAdmin = (bool)$me['is_admin'];

    if ($method === 'GET' && $action === 'data') {
        $uid = target_user($me, $_GET['u'] ?? null);
        $owner = $pdo->prepare('SELECT id, username, display_name, is_admin FROM users WHERE id = ?');
        $owner->execute([$uid]);
        $e = $pdo->prepare('SELECT id, day, nick, place_id, c, cb, w, wb, s, sb, k, kb, manuell, info, status, teil FROM bookings WHERE user_id = ? ORDER BY day, id');
        $e->execute([$uid]);
        $p = $pdo->prepare('SELECT id, valid_from, c, w, s, k, cb, wb, sb, kb FROM prices WHERE user_id = ? ORDER BY valid_from');
        $p->execute([$uid]);
        $out = [
            'owner' => user_public($owner->fetch()),
            'bookings' => array_map('cast_booking', $e->fetchAll()),
            'places' => list_places($uid),
            'prices' => array_map('cast_price', $p->fetchAll()),
        ];
        if ($isAdmin) $out['users'] = list_users();
        json_out($out);
    }

    if ($method === 'POST' && $action === 'saveEntry') {
        fail('Es gibt eine neue Version der App. Bitte Seite neu laden.', 409);
    }

    if ($method === 'POST' && $action === 'saveBooking') {
        $uid = target_user($me, $in['u'] ?? null);
        $row = ['day' => valid_day($in['day'] ?? '')];
        $row['nick'] = mb_substr(trim(preg_replace('/\s+/u', ' ', (string)($in['nick'] ?? ''))), 0, 40);
        $any = false;
        foreach (FIELDS as $f) {
            $row[$f] = num($in[$f] ?? 0, 0, 100000);
            if ($row[$f] != 0) $any = true;
        }
        $row['manuell'] = num($in['manuell'] ?? 0, -10000000, 10000000);
        $row['info'] = mb_substr(trim((string)($in['info'] ?? '')), 0, 500);
        $status = (string)($in['status'] ?? 'bezahlt');
        $row['status'] = $status === 'offen' ? 'offen' : 'bezahlt';
        $pid = (int)($in['place_id'] ?? 0);
        if ($pid) {
            $chk = $pdo->prepare('SELECT 1 FROM places WHERE id = ? AND user_id = ?');
            $chk->execute([$pid, $uid]);
            if (!$chk->fetch()) fail('Diese Anlaufstelle gibt es nicht (mehr). Bitte Seite neu laden.');
        }
        $row['place_id'] = $pid ?: null;
        $teil = $in['teil'] ?? null;
        $row['teil'] = ($teil === null || $teil === '') ? null : num($teil, 0, 10000000);
        if (!$any && $row['manuell'] == 0 && $row['info'] === '') fail('Bitte mindestens eine Stückzahl, einen Betrag oder eine Info eintragen.');
        $row['updated_at'] = now_iso();
        $id = (int)($in['id'] ?? 0);
        if ($id) {
            $sets = implode(',', array_map(fn($c) => "$c = :$c", array_keys($row)));
            $st = $pdo->prepare("UPDATE bookings SET $sets WHERE id = :id AND user_id = :uid");
            $st->execute($row + ['id' => $id, 'uid' => $uid]);
            if ($st->rowCount() === 0) fail('Eintrag nicht gefunden (vielleicht gelöscht).', 404);
        } else {
            $row['user_id'] = $uid;
            $row['created_at'] = $row['updated_at'];
            $cols = array_keys($row);
            $pdo->prepare('INSERT INTO bookings (' . implode(',', $cols) . ') VALUES (:' . implode(',:', $cols) . ')')->execute($row);
            $id = (int)$pdo->lastInsertId();
        }
        $st = $pdo->prepare('SELECT id, day, nick, place_id, c, cb, w, wb, s, sb, k, kb, manuell, info, status, teil FROM bookings WHERE id = ?');
        $st->execute([$id]);
        json_out(['ok' => true, 'booking' => cast_booking($st->fetch())]);
    }

    if ($method === 'POST' && $action === 'savePlace') {
        $uid = target_user($me, $in['u'] ?? null);
        $name = trim(preg_replace('/\s+/u', ' ', (string)($in['name'] ?? '')));
        if ($name === '' || mb_strlen($name) > 40) fail('Name: 1–40 Zeichen.');
        $id = (int)($in['id'] ?? 0);
        $dup = $pdo->prepare('SELECT id FROM places WHERE user_id = ? AND name = ? COLLATE NOCASE AND id != ?');
        $dup->execute([$uid, $name, $id]);
        if ($dup->fetch()) fail('Diese Anlaufstelle gibt es schon.');
        if ($id) {
            $st = $pdo->prepare('UPDATE places SET name = ? WHERE id = ? AND user_id = ?');
            $st->execute([$name, $id, $uid]);
            if ($st->rowCount() === 0) fail('Anlaufstelle nicht gefunden.', 404);
        } else {
            $n = $pdo->prepare('SELECT COALESCE(MAX(sort), 0) + 1 FROM places WHERE user_id = ?');
            $n->execute([$uid]);
            $pdo->prepare('INSERT INTO places (user_id, name, sort, created_at) VALUES (?, ?, ?, ?)')->execute([$uid, $name, (int)$n->fetchColumn(), now_iso()]);
            $id = (int)$pdo->lastInsertId();
        }
        json_out(['ok' => true, 'id' => $id, 'places' => list_places($uid)]);
    }

    if ($method === 'POST' && $action === 'deletePlace') {
        $uid = target_user($me, $in['u'] ?? null);
        $id = (int)($in['id'] ?? 0);
        $c = $pdo->prepare('SELECT COUNT(*) FROM bookings WHERE user_id = ? AND place_id = ?');
        $c->execute([$uid, $id]);
        if ((int)$c->fetchColumn() > 0) fail('An dieser Anlaufstelle hängen noch Einträge. Du kannst sie umbenennen, aber nicht löschen.');
        $pdo->prepare('DELETE FROM places WHERE id = ? AND user_id = ?')->execute([$id, $uid]);
        json_out(['ok' => true, 'places' => list_places($uid)]);
    }

    if ($method === 'POST' && $action === 'assignUnplaced') {
        $uid = target_user($me, $in['u'] ?? null);
        $id = (int)($in['id'] ?? 0);
        $chk = $pdo->prepare('SELECT 1 FROM places WHERE id = ? AND user_id = ?');
        $chk->execute([$id, $uid]);
        if (!$chk->fetch()) fail('Anlaufstelle nicht gefunden.', 404);
        $st = $pdo->prepare('UPDATE bookings SET place_id = ?, updated_at = ? WHERE user_id = ? AND place_id IS NULL');
        $st->execute([$id, now_iso(), $uid]);
        json_out(['ok' => true, 'moved' => $st->rowCount()]);
    }

    if ($method === 'POST' && $action === 'deleteBooking') {
        $uid = target_user($me, $in['u'] ?? null);
        $pdo->prepare('DELETE FROM bookings WHERE id = ? AND user_id = ?')->execute([(int)($in['id'] ?? 0), $uid]);
        json_out(['ok' => true]);
    }

    if ($method === 'POST' && $action === 'savePrice') {
        $uid = target_user($me, $in['u'] ?? null);
        $day = valid_day($in['valid_from'] ?? '');
        $vals = [];
        foreach (FIELDS as $f) {
            $v = $in[$f] ?? null;
            $vals[$f] = ($v === null || $v === '') ? null : num($v, 0, 1000000);
        }
        $id = isset($in['id']) ? (int)$in['id'] : 0;
        if ($id) {
            $own = $pdo->prepare('SELECT id FROM prices WHERE id = ? AND user_id = ?');
            $own->execute([$id, $uid]);
            if (!$own->fetch()) fail('Preiszeile nicht gefunden.', 404);
        }
        $clash = $pdo->prepare('SELECT id FROM prices WHERE user_id = ? AND valid_from = ? AND id != ?');
        $clash->execute([$uid, $day, $id]);
        if ($clash->fetch()) fail('Für dieses Datum gibt es schon eine Preiszeile. Bitte die vorhandene bearbeiten.');
        $first = $pdo->prepare('SELECT MIN(valid_from) FROM prices WHERE user_id = ? AND id != ?');
        $first->execute([$uid, $id]);
        $minOther = $first->fetchColumn();
        if (($minOther === null || $minOther === false || $day < $minOther) && in_array(null, $vals, true)) {
            fail('Die erste Preiszeile braucht alle 8 Preise (0 ist erlaubt).');
        }
        if ($id) {
            $sql = 'UPDATE prices SET valid_from = ?, ' . implode(',', array_map(fn($f) => "$f = ?", FIELDS)) . ' WHERE id = ? AND user_id = ?';
            $pdo->prepare($sql)->execute(array_merge([$day], array_values($vals), [$id, $uid]));
        } else {
            $sql = 'INSERT INTO prices (user_id, valid_from, ' . implode(',', FIELDS) . ') VALUES (?, ?, ' . implode(',', array_fill(0, 8, '?')) . ')';
            $pdo->prepare($sql)->execute(array_merge([$uid, $day], array_values($vals)));
        }
        json_out(['ok' => true]);
    }

    if ($method === 'POST' && $action === 'deletePrice') {
        $uid = target_user($me, $in['u'] ?? null);
        $pdo->prepare('DELETE FROM prices WHERE id = ? AND user_id = ?')->execute([(int)($in['id'] ?? 0), $uid]);
        json_out(['ok' => true]);
    }

    if ($method === 'POST' && $action === 'changePassword') {
        $st = $pdo->prepare('SELECT pass_hash FROM users WHERE id = ?');
        $st->execute([$me['id']]);
        if (!password_verify((string)($in['old'] ?? ''), (string)$st->fetchColumn())) fail('Das alte Passwort stimmt nicht.');
        set_password((int)$me['id'], (string)($in['new'] ?? ''));
        json_out(['ok' => true]);
    }

    // Ab hier nur Admin
    if (!$isAdmin) fail('Nur für Admins.', 403);

    if ($method === 'GET' && $action === 'backup') {
        // Vollständige, konsistente Kopie der Datenbank zum Herunterladen
        $tmp = tempnam(sys_get_temp_dir(), 'mb');
        @unlink($tmp);
        $pdo->exec('VACUUM INTO ' . $pdo->quote($tmp));
        $name = 'monatsbuch-sicherung-' . date('Y-m-d') . '.sqlite';
        header('Content-Type: application/vnd.sqlite3');
        header('Content-Disposition: attachment; filename="' . $name . '"');
        header('Content-Length: ' . filesize($tmp));
        header('Cache-Control: no-store');
        readfile($tmp);
        @unlink($tmp);
        exit;
    }

    if ($method === 'POST' && $action === 'createUser') {
        $id = create_user($in['username'] ?? '', $in['name'] ?? '', $in['password'] ?? '', !empty($in['isAdmin']));
        if (!empty($in['copyPricesFrom'])) {
            $src = target_user($me, $in['copyPricesFrom']);
            $pdo->prepare('INSERT INTO prices (user_id, valid_from, ' . implode(',', FIELDS) . ')
                           SELECT ?, valid_from, ' . implode(',', FIELDS) . ' FROM prices WHERE user_id = ?')
                ->execute([$id, $src]);
        }
        json_out(['ok' => true, 'id' => $id, 'users' => list_users()]);
    }

    if ($method === 'POST' && $action === 'updateUser') {
        $id = (int)($in['id'] ?? 0);
        $u = $pdo->prepare('SELECT * FROM users WHERE id = ?');
        $u->execute([$id]);
        $user = $u->fetch();
        if (!$user) fail('Benutzer nicht gefunden.', 404);
        if (isset($in['name'])) {
            $name = clean_name($in['name']);
            $pdo->prepare('UPDATE users SET display_name = ? WHERE id = ?')->execute([$name, $id]);
        }
        if (isset($in['isAdmin'])) {
            $want = !empty($in['isAdmin']) ? 1 : 0;
            if (!$want && $id === (int)$me['id']) fail('Du kannst dir die Admin-Rechte nicht selbst nehmen.');
            if (!$want && admin_count() <= 1 && $user['is_admin']) fail('Es muss mindestens einen Admin geben.');
            $pdo->prepare('UPDATE users SET is_admin = ? WHERE id = ?')->execute([$want, $id]);
        }
        if (!empty($in['password'])) set_password($id, (string)$in['password']);
        json_out(['ok' => true, 'users' => list_users()]);
    }

    if ($method === 'POST' && $action === 'deleteUser') {
        $id = (int)($in['id'] ?? 0);
        if ($id === (int)$me['id']) fail('Du kannst dich nicht selbst löschen.');
        $pdo->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);
        json_out(['ok' => true, 'users' => list_users()]);
    }

    fail('Unbekannte Aktion.', 404);
}

function target_user(array $me, $requested): int
{
    $uid = $requested === null || $requested === '' ? (int)$me['id'] : (int)$requested;
    if ($uid !== (int)$me['id'] && !$me['is_admin']) fail('Kein Zugriff auf diese Tabelle.', 403);
    $st = db()->prepare('SELECT 1 FROM users WHERE id = ?');
    $st->execute([$uid]);
    if (!$st->fetch()) fail('Benutzer nicht gefunden.', 404);
    return $uid;
}

function list_users(): array
{
    $rows = db()->query('SELECT u.id, u.username, u.display_name, u.is_admin,
        (SELECT COUNT(DISTINCT day) FROM bookings e WHERE e.user_id = u.id) AS days,
        (SELECT MAX(day) FROM bookings e WHERE e.user_id = u.id) AS last_day
        FROM users u ORDER BY u.display_name COLLATE NOCASE')->fetchAll();
    return array_map(fn($u) => user_public($u) + ['days' => (int)$u['days'], 'lastDay' => $u['last_day']], $rows);
}

function admin_count(): int
{
    return (int)db()->query('SELECT COUNT(*) FROM users WHERE is_admin = 1')->fetchColumn();
}

function create_user($username, $name, $password, bool $admin): int
{
    $username = trim((string)$username);
    if (!preg_match('/^[A-Za-z0-9._-]{3,32}$/', $username)) {
        fail('Benutzername: 3–32 Zeichen, nur Buchstaben, Ziffern, Punkt, Minus, Unterstrich.');
    }
    $name = clean_name($name ?: $username);
    check_password((string)$password);
    $st = db()->prepare('SELECT 1 FROM users WHERE username = ?');
    $st->execute([$username]);
    if ($st->fetch()) fail('Diesen Benutzernamen gibt es schon.');
    db()->prepare('INSERT INTO users (username, display_name, pass_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?)')
        ->execute([$username, $name, password_hash((string)$password, PASSWORD_DEFAULT), $admin ? 1 : 0, now_iso()]);
    return (int)db()->lastInsertId();
}

function clean_name($name): string
{
    $name = trim(preg_replace('/\s+/u', ' ', (string)$name));
    if ($name === '' || mb_strlen($name) > 40) fail('Name: 1–40 Zeichen.');
    return $name;
}

function check_password(string $pw): void
{
    if (mb_strlen($pw) < 8) fail('Das Passwort braucht mindestens 8 Zeichen.');
}

function set_password(int $id, string $pw): void
{
    check_password($pw);
    db()->prepare('UPDATE users SET pass_hash = ? WHERE id = ?')->execute([password_hash($pw, PASSWORD_DEFAULT), $id]);
}

function valid_day($d): string
{
    $d = (string)$d;
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $d, $m) || !checkdate((int)$m[2], (int)$m[3], (int)$m[1])) {
        fail('Ungültiges Datum.');
    }
    return $d;
}

function num($v, float $min, float $max): float
{
    if (is_string($v)) $v = str_replace(',', '.', trim($v));
    if ($v === '' || $v === null) return 0.0;
    if (!is_numeric($v)) fail('Bitte nur Zahlen eintragen.');
    $f = (float)$v;
    if ($f < $min || $f > $max) fail('Zahl außerhalb des erlaubten Bereichs.');
    return round($f, 2);
}

function list_places(int $uid): array
{
    $st = db()->prepare('SELECT p.id, p.name, (SELECT COUNT(*) FROM bookings b WHERE b.place_id = p.id) AS n FROM places p WHERE p.user_id = ? ORDER BY p.sort, p.id');
    $st->execute([$uid]);
    return array_map(fn($r) => ['id' => (int)$r['id'], 'name' => $r['name'], 'n' => (int)$r['n']], $st->fetchAll());
}

function cast_booking(array $r): array
{
    $r['id'] = (int)$r['id'];
    $r['place_id'] = isset($r['place_id']) ? (int)$r['place_id'] ?: null : null;
    foreach (array_merge(FIELDS, ['manuell']) as $f) $r[$f] = (float)$r[$f];
    $r['teil'] = $r['teil'] === null ? null : (float)$r['teil'];
    return $r;
}

function cast_entry(array $r): array
{
    foreach (array_merge(FIELDS, ['manuell']) as $f) $r[$f] = (float)$r[$f];
    $r['teil'] = $r['teil'] === null ? null : (float)$r['teil'];
    return $r;
}

function cast_price(array $r): array
{
    $r['id'] = (int)$r['id'];
    foreach (FIELDS as $f) $r[$f] = $r[$f] === null ? null : (float)$r[$f];
    return $r;
}
