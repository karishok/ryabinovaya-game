#!/usr/bin/env bash
# Разворачивает «Рябиновую» на чистом сервере и обновляет уже развёрнутую.
# Запускать на самом сервере от root:
#   bash <(curl -fsSL https://raw.githubusercontent.com/karishok/ryabinovaya-game/main/deploy.sh)
set -euo pipefail

REPO="https://github.com/karishok/ryabinovaya-game.git"
ROOT="/var/www/ryabinovaya"
SITE="ryabinovaya"

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

cat > "$CONF_PATH" <<'CONF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    root /var/www/ryabinovaya;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }

    # Картинки склада и сканера не меняются между релизами.
    location ~* \.(webp|png|jpg|jpeg|svg|ico|woff2?)$ {
        expires 30d;
        add_header Cache-Control "public";
    }

    # Разметка, стили и логика обновляются каждым деплоем — их кэшировать нельзя,
    # иначе игрок после обновления увидит старую версию.
    location ~* \.(html|css|js)$ {
        expires -1;
        add_header Cache-Control "no-cache";
    }

    gzip on;
    gzip_min_length 1024;
    gzip_types text/css application/javascript text/html image/svg+xml;
}
CONF

if [ -n "$ENABLED_DIR" ]; then
  ln -sf "$CONF_PATH" "$ENABLED_DIR/$SITE"
  # Дефолтный сайт тоже слушает :80 как default_server — иначе конфликт.
  rm -f "$ENABLED_DIR/default"
fi

log "Проверяю конфиг и перезапускаю"
nginx -t
systemctl enable nginx >/dev/null 2>&1 || true
systemctl restart nginx

log "Проверяю, что игра отдаётся"
code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/)
if [ "$code" = "200" ] && curl -s http://127.0.0.1/ | grep -q "Рябиновая"; then
  ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  printf '\nГотово: http://%s/\n' "${ip:-<ip-сервера>}"
else
  echo "nginx ответил $code — посмотрите journalctl -u nginx и nginx -t" >&2
  exit 1
fi
