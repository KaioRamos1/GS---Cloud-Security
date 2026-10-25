#!/usr/bin/env bash
# Executar numa VM Ubuntu dedicada a este laboratorio. Nao altera o NSG.
set -Eeuo pipefail
if [[ $EUID -ne 0 || $# -ne 2 ]]; then
  echo 'Uso: sudo bash deploy/install.sh DOMINIO EMAIL_CERTIFICADO' >&2
  exit 1
fi
DOMAIN=$1
CERT_EMAIL=$2
if [[ ! $DOMAIN =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$ || $DOMAIN == *..* || $CERT_EMAIL != *@* ]]; then
  echo 'Dominio ou email invalido.' >&2
  exit 1
fi
SOURCE_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$SOURCE_DIR"
python3 -m unittest -v test_api.py
apt-get update
apt-get install -y python3-venv nginx certbot apache2-utils
id minhafrota >/dev/null 2>&1 || useradd --system --user-group --home-dir /var/lib/minhafrota --shell /usr/sbin/nologin minhafrota
install -d -m 0755 /opt/minhafrota /opt/minhafrota/static /var/www/letsencrypt
install -m 0644 app.py schema.sql dashboard.html requirements.txt /opt/minhafrota/
install -m 0644 static/app.js static/style.css static/kaio-hero.png /opt/minhafrota/static/
python3 -m venv /opt/minhafrota/.venv
/opt/minhafrota/.venv/bin/python -m pip install -r /opt/minhafrota/requirements.txt
install -m 0644 deploy/minhafrota.service /etc/systemd/system/minhafrota.service
systemctl daemon-reload
systemctl enable --now minhafrota
systemctl restart minhafrota
# Bootstrap: app stays private until TLS and authentication are configured.
if [[ ! -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]]; then
  sed "s/__DOMAIN__/$DOMAIN/g" deploy/nginx-http.conf > /etc/nginx/sites-available/minhafrota
  ln -sfn /etc/nginx/sites-available/minhafrota /etc/nginx/sites-enabled/minhafrota
  # The default nginx welcome page is unnecessary on this dedicated VM.
  if [[ -L /etc/nginx/sites-enabled/default ]]; then unlink /etc/nginx/sites-enabled/default; fi
  nginx -t
  systemctl reload nginx
  certbot certonly --webroot -w /var/www/letsencrypt -d "$DOMAIN" --email "$CERT_EMAIL" --agree-tos --non-interactive
fi
if [[ ! -f /etc/nginx/minhafrota.htpasswd ]]; then
  echo 'Defina a senha do usuario avaliador (nao sera exibida):'
  htpasswd -cB /etc/nginx/minhafrota.htpasswd avaliador
fi
chown root:www-data /etc/nginx/minhafrota.htpasswd
chmod 0640 /etc/nginx/minhafrota.htpasswd
sed "s/__DOMAIN__/$DOMAIN/g" deploy/nginx-https.conf > /etc/nginx/sites-available/minhafrota
ln -sfn /etc/nginx/sites-available/minhafrota /etc/nginx/sites-enabled/minhafrota
nginx -t
systemctl reload nginx
install -d /etc/letsencrypt/renewal-hooks/deploy
install -m 0755 deploy/reload-nginx.sh /etc/letsencrypt/renewal-hooks/deploy/minhafrota-nginx
systemctl enable --now certbot.timer
curl --fail http://127.0.0.1:3001/api/health
printf '\nAbra https://%s e autentique como avaliador.\n' "$DOMAIN"
