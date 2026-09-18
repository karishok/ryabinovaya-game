#!/usr/bin/env bash
# Разворачивает «Рябиновую» на чистом сервере и обновляет уже развёрнутую.
# Запускать на самом сервере от root:
#   bash <(curl -fsSL https://raw.githubusercontent.com/karishok/ryabinovaya-game/main/deploy.sh)
# Порт можно задать своим:
#   PORT=9137 bash <(curl -fsSL .../deploy.sh)
set -euo pipefail

REPO="https://github.com/karishok/ryabinovaya-game.git"
ROOT="/var/www/ryabinovaya"
SITE="ryabinovaya"
# Отдельный порт, а не 80: игра не отбирает его у того, что уже крутится на
# сервере, и разворачивается рядом, ничего не ломая.
PORT="${PORT:-8421}"

log() { printf '\n==> %s\n' "$1"; }

log "Ставлю nginx и git"
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y nginx git
  CONF_DIR="/etc/nginx/sites-available"
  ENABLED_DIR="/etc/nginx/sites-enabled"
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y nginx git
  CONF_DIR="/etc/nginx/conf.d"
  ENABLED_DIR=""
elif command -v yum >/dev/null 2>&1; then
  yum install -y nginx git
  CONF_DIR="/etc/nginx/conf.d"
  ENABLED_DIR=""
else
  echo "Не нашёл apt/dnf/yum — поставьте nginx и git вручную и запустите скрипт снова." >&2
  exit 1
fi

log "Забираю код из GitHub"
if [ -d "$ROOT/.git" ]; then
  git -C "$ROOT" fetch --depth 1 origin main
  git -C "$ROOT" reset --hard origin/main
else
  rm -rf "$ROOT"
  git clone --depth 1 "$REPO" "$ROOT"
fi

log "Настраиваю nginx"
# Имя файла зависит от раскладки дистрибутива: Debian держит сайты в
# sites-available, RHEL — всё в conf.d.
if [ -n "$ENABLED_DIR" ]; then
  CONF_PATH="$CONF_DIR/$SITE"
else
  CONF_PATH="$CONF_DIR/$SITE.conf"
fi

# Порт подставляется ниже через sed: в heredoc с подстановкой пришлось бы
# экранировать $uri, и одна забытая обратная косая ломала бы конфиг молча.
cat > "$CONF_PATH" <<'CONF'
server {
    listen __PORT__;
__LISTEN6__
    server_name _;

    root /var/www/ryabinovaya;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }

    # Картинки склада и сканера не меняются между релизами.
    location ~* \.(webp|png|jpg|jpeg|svg|ico|woff2?)$ {
        expires 30d;
    }

    # Разметка, стили и логика обновляются каждым деплоем — их кэшировать нельзя,
    # иначе игрок после обновления увидит старую версию.
    location ~* \.(html|css|js)$ {
        expires -1;
    }

    gzip on;
    gzip_min_length 1024;
    # text/html nginx сжимает всегда и в gzip_types его перечислять нельзя —
    # получается «duplicate MIME type» при проверке конфига.
    gzip_types text/css application/javascript image/svg+xml;
}
CONF

sed -i "s/__PORT__/$PORT/g" "$CONF_PATH"

# На хосте без IPv6 строка listen [::] роняет весь nginx -t, поэтому она
# появляется в конфиге только если стек действительно поднят.
if [ -s /proc/net/if_inet6 ]; then
  sed -i "s/^__LISTEN6__$/    listen [::]:$PORT;/" "$CONF_PATH"
else
  sed -i "/^__LISTEN6__$/d" "$CONF_PATH"
fi

if [ -n "$ENABLED_DIR" ]; then
  ln -sf "$CONF_PATH" "$ENABLED_DIR/$SITE"
fi

# Нестандартный порт закрыт брандмауэром и запрещён SELinux по умолчанию:
# без этого игра открывается с самого сервера, но не снаружи.
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
  log "Открываю порт $PORT в ufw"
  ufw allow "$PORT/tcp" || true
fi
if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
  log "Открываю порт $PORT в firewalld"
  firewall-cmd --permanent --add-port="$PORT/tcp" || true
  firewall-cmd --reload || true
fi
if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce 2>/dev/null || echo Disabled)" = "Enforcing" ]; then
  log "Разрешаю порт $PORT в SELinux"
  command -v semanage >/dev/null 2>&1 || (command -v dnf >/dev/null 2>&1 && dnf install -y policycoreutils-python-utils) || true
  semanage port -a -t http_port_t -p tcp "$PORT" 2>/dev/null \
    || semanage port -m -t http_port_t -p tcp "$PORT" 2>/dev/null || true
fi

# Короткая команда для последующих обновлений. Не алиас в .bashrc: алиас
# живёт только в интерактивной оболочке и не виден ни cron, ни ssh-команде.
log "Ставлю команду ryabinovaya"
cat > /usr/local/bin/ryabinovaya <<'CMD'
#!/usr/bin/env bash
# Обновляет «Рябиновую» до свежего main и перезапускает nginx.
# Порт можно сменить: PORT=9137 ryabinovaya
exec bash <(curl -fsSL https://raw.githubusercontent.com/karishok/ryabinovaya-game/main/deploy.sh)
CMD
chmod +x /usr/local/bin/ryabinovaya

log "Проверяю конфиг и перезапускаю"
nginx -t
systemctl enable nginx >/dev/null 2>&1 || true
systemctl restart nginx

log "Проверяю, что игра отдаётся"
url="http://127.0.0.1:$PORT/"
code=$(curl -s -o /dev/null -w '%{http_code}' "$url" || true)
body=$(curl -fsS "$url" 2>/dev/null || true)

# Маркер намеренно латиницей: кириллица в grep зависит от локали сервера,
# а подключение движка в index.html есть при любой локали.
if [ "$code" = "200" ] && printf '%s' "$body" | grep -q 'game-engine.js'; then
  ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  printf '\nГотово: http://%s:%s/\n' "${ip:-<ip-сервера>}" "$PORT"
  printf 'Обновлять дальше — командой: ryabinovaya\n'
  printf 'Если снаружи не открывается — порт %s режет брандмауэр хостера, а не сервер.\n' "$PORT"
else
  echo "Ожидал игру, а по $url пришёл ответ $code. Начало ответа:" >&2
  printf '%s\n' "$body" | head -5 >&2
  echo >&2
  echo "Кто занял порт $PORT:" >&2
  echo "  nginx -T | grep -n -B2 -A6 'listen .*$PORT'" >&2
  echo "  ss -lntp | grep :$PORT" >&2
  exit 1
fi
