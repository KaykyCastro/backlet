#!/bin/bash

# Pega o caminho de onde o script está salvo
BASE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# Configuração dos caminhos (Baseado na sua estrutura)
CAMINHO_BACK="$BASE_DIR/backlet"
CAMINHO_FRONT="$BASE_DIR/let"

echo "🧹 Limpando processos antigos (Vite/Node)..."
fuser -k 5173/tcp 5174/tcp 3000/tcp 2>/dev/null

echo "🚀 Iniciando o sistema..."

# 1. Inicia o Backend
if [ -d "$CAMINHO_BACK" ]; then
    echo "📡 Iniciando Backend em $CAMINHO_BACK"
    cd "$CAMINHO_BACK"
    # Usando npm run dev ou start conforme seu package.json
    node index.js & 
    BACK_PID=$!
else
    echo "❌ Erro: Pasta do backend não encontrada!"
    exit 1
fi

# 2. Inicia o Frontend
if [ -d "$CAMINHO_FRONT" ]; then
    echo "💻 Iniciando Frontend em $CAMINHO_FRONT"
    cd "$CAMINHO_FRONT"
    npm run dev &
    FRONT_PID=$!
else
    echo "❌ Erro: Pasta do frontend não encontrada!"
    kill $BACK_PID
    exit 1
fi

# 3. Aguarda o servidor subir
echo "⏳ Aguardando inicialização..."
sleep 5

# 4. Abre o navegador
echo "🌐 Abrindo navegador..."
xdg-open http://localhost:5173

# Encerra tudo ao fechar o terminal
trap "echo 'Fechando processos...'; kill $BACK_PID $FRONT_PID; exit" SIGINT SIGTERM

echo "✅ Tudo pronto. Ctrl+C para encerrar."
wait
