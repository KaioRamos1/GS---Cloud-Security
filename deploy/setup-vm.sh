#!/usr/bin/env bash
set -euo pipefail

sudo apt-get update
sudo apt-get install -y unzip curl

curl -fsSL https://bun.sh/install | bash

sudo mkdir -p /var/lib/minhas-tarefas
sudo chown -R azureuser:azureuser /var/lib/minhas-tarefas

sudo cp minhas-tarefas.service /etc/systemd/system/minhas-tarefas.service
sudo systemctl daemon-reload
sudo systemctl enable --now minhas-tarefas

systemctl status minhas-tarefas --no-pager
