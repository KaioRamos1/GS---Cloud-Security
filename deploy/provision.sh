#!/usr/bin/env bash
set -euo pipefail

IP="${1:?uso: ./provision.sh <IP-da-VM> <caminho-do-pem>}"
PEM="${2:?uso: ./provision.sh <IP-da-VM> <caminho-do-pem>}"

SSH_CMD=(ssh -i "$PEM" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 azureuser@"$IP")

echo "[1/7] Permissões da chave SSH"
chmod 400 "$PEM"

echo "[2/7] Testando conexão SSH"
"${SSH_CMD[@]}" "echo ok"

echo "[3/7] Instalando Bun na VM"
"${SSH_CMD[@]}" "sudo apt-get update -qq && sudo apt-get install -y -qq unzip curl && curl -fsSL https://bun.sh/install | bash"

echo "[4/7] Preparando diretórios (código + banco fora do código)"
"${SSH_CMD[@]}" "sudo mkdir -p /opt/minhas-tarefas /var/lib/minhas-tarefas && sudo chown -R azureuser:azureuser /opt/minhas-tarefas /var/lib/minhas-tarefas"

echo "[5/7] Copiando o código da API"
tar czf - --exclude node_modules --exclude .git --exclude bun.lock -C "$(dirname "$0")/.." . \
  | "${SSH_CMD[@]}" "tar xzf - -C /opt/minhas-tarefas"

echo "[6/7] Instalando o serviço systemd (porta 80, restart automático)"
"${SSH_CMD[@]}" "sudo cp /opt/minhas-tarefas/deploy/minhas-tarefas.service /etc/systemd/system/minhas-tarefas.service && sudo systemctl daemon-reload && sudo systemctl enable --now minhas-tarefas && sleep 2 && systemctl is-active minhas-tarefas"

echo "[7/7] Testando a API na própria VM"
"${SSH_CMD[@]}" "curl -s http://localhost/api/health"

echo
echo "Testando da sua máquina (fim a fim):"
curl -s "http://$IP/api/health"
echo
echo "Deploy concluído: http://$IP"
