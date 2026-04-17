import express from "express";
import prisma from "./src/lib/prisma.js"
import dotenv from "dotenv";
import cors from "cors";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import multer from "multer";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const upload = multer({ dest: "uploads/" });
const DB_PATH = path.join(__dirname, "database.db"); 

app.use(cors());
app.use(express.json());

app.get("/backup", (req, res) => {
  // 1. Use o caminho correto (database.db na raiz)
  const DB_SOURCE = path.resolve(__dirname, "database.db"); 
  const backupTempPath = path.resolve(__dirname, "temp-backup.db");

  // Verificação de segurança: o arquivo de origem existe?
  if (!fs.existsSync(DB_SOURCE)) {
    console.error("Arquivo original não encontrado em:", DB_SOURCE);
    return res.status(404).send("Arquivo de banco de dados original não encontrado.");
  }

  // 2. Abre a conexão com o banco oficial
  const db = new Database(DB_SOURCE);

  // 3. Gera o snapshot do backup
  db.backup(backupTempPath)
    .then(() => {
      // 4. Envia o arquivo para o navegador
      res.download(backupTempPath, "backup-sistema.db", (err) => {
        if (err) {
          console.error("Erro no download:", err);
        }
        
        // 5. SEMPRE feche a instância e remova o temporário
        db.close(); 
        if (fs.existsSync(backupTempPath)) {
          fs.unlinkSync(backupTempPath);
        }
      });
    })
    .catch((err) => {
      console.error("Erro ao gerar backup:", err);
      if (db) db.close();
      res.status(500).send("Erro interno ao gerar backup");
    });
});

app.post('/restore', upload.single('backup'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado' });
  const tempPath = req.file.path;

  try {
    // 1. Para o Prisma
    await prisma.$disconnect();

    // 2. Abre o backup e derrama no database.db da raiz
    const backupDb = new Database(tempPath);
    await backupDb.backup(DB_PATH);
    backupDb.close();

    // 3. Limpa arquivos WAL/SHM do database.db (se existirem)
    ['wal', 'shm'].forEach(ext => {
      const file = `${DB_PATH}-${ext}`;
      if (fs.existsSync(file)) fs.unlinkSync(file);
    });

    // 4. Remove o temporário do upload
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

    // 5. Aguarda o Linux liberar o arquivo
    await new Promise(r => setTimeout(r, 1000));

    // 6. Reconecta
    await prisma.$connect();

    console.log("Restauração feita com sucesso no arquivo:", DB_PATH);
    res.json({ message: 'Backup restaurado com sucesso!' });
  } catch (error) {
    console.error("Erro no restore:", error);
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    res.status(500).json({ error: 'Falha na restauração' });
  }
});

/* =========================
   USUÁRIOS
========================= */

app.post("/usuarios", async (req, res) => {
  try {
    const usuario = await prisma.usuario.create({
      data: {
        ...req.body,
        divida: Number(req.body.divida) || 0,
      },
    });
    res.json(usuario);
  } catch (error) {
    console.error("Erro ao criar usuário:", error);
    res.status(500).json({ error: error.message });
  }
});

app.put("/usuarios/:id", async (req, res) => {
  try {
    const usuario = await prisma.usuario.update({
      where: { id: Number(req.params.id) },
      data: req.body,
    });
    res.json(usuario);
  } catch (error) {
    console.error("Erro ao atualizar usuário:", error);
    res.status(500).json({ error: error.message });
  }
});

app.delete("/usuarios/:id", async (req, res) => {
  try {
    await prisma.usuario.delete({
      where: { id: Number(req.params.id) },
    });
    res.json({ message: "Usuário deletado" });
  } catch (error) {
    console.error("Erro ao deletar usuário:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/usuarios", async (req, res) => {
  try {
    const { nome } = req.query;
    const where = {};

    if (nome) {
      where.nome = { contains: nome };
    }

    const usuarios = await prisma.usuario.findMany({
      where,
      include: { pagamentos: true, vendas: true },
      orderBy: { nome: "asc" },
    });

    res.json(usuarios);
  } catch (error) {
    console.error("Erro ao listar usuários:", error);
    res.status(500).json({ error: error.message });
  }
});

/* =========================
   PAGAMENTOS
========================= */

app.post("/usuarios/:id/pagamentos", async (req, res) => {
  try {
    const { valor } = req.body;
    const usuarioId = Number(req.params.id);

    const pagamento = await prisma.pagamento.create({
      data: {
        valor: Number(valor),
        usuarioId,
      },
    });

    await prisma.usuario.update({
      where: { id: usuarioId },
      data: {
        divida: {
          decrement: Number(valor),
        },
      },
    });

    res.json(pagamento);
  } catch (error) {
    console.error("Erro ao adicionar pagamento:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/usuarios/:id/pagamentos", async (req, res) => {
  try {
    const usuarioId = Number(req.params.id);

    const pagamentos = await prisma.pagamento.findMany({
      where: { usuarioId },
      orderBy: { data: "desc" },
    });

    res.json(pagamentos);
  } catch (error) {
    console.error("Erro ao listar pagamentos:", error);
    res.status(500).json({ error: error.message });
  }
});

/* =========================
   PRODUTOS
========================= */

app.post("/produtos", async (req, res) => {
  try {
    const produto = await prisma.produto.create({
      data: {
        ...req.body,
        preco: Number(req.body.preco),
        estoque: Number(req.body.estoque),
        categoriaId: Number(req.body.categoriaId),
      },
    });
    res.json(produto);
  } catch (error) {
    console.error("Erro ao criar produto:", error);
    res.status(500).json({ error: error.message });
  }
});

app.put("/produtos/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, code, preco, estoque, categoriaId } = req.body;

    const produto = await prisma.produto.update({
      where: { id: Number(id)},
      data: {
        nome,
        code: code,
        preco: Number(preco),
        estoque: Number(estoque),
        categoriaId: Number(categoriaId),
      },
    });

    res.json(produto);
  } catch (error) {
    console.error("Erro ao atualizar produto: ", error);
    res.status(500).json({ error: error.message });
  }
});

app.delete("/produtos/:id", async (req, res) => {
  try {
    await prisma.produto.delete({
      where: { id: Number(req.params.id) },
    });
    res.json({ message: "Produto deletado" });
  } catch (error) {
    console.error("Erro ao deletar produto:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/produtos", async (req, res) => {
  try {
    const { nome, categoriaId, estoque } = req.query;
    const where = {};

    if (nome) where.nome = { contains: nome };
    if (categoriaId) where.categoriaId = Number(categoriaId);
    if (estoque === "sem") where.estoque = 0;
    if (estoque === "com") where.estoque = { gt: 0 };

    const produtos = await prisma.produto.findMany({
      where,
      include: { categoria: true },
      orderBy: { nome: "asc" },
    });

    res.json(produtos);
  } catch (error) {
    console.error("Erro ao listar produtos:", error);
    res.status(500).json({ error: error.message });
  }
});

/* =========================
   CATEGORIAS
========================= */

app.post("/categorias", async (req, res) => {
  try {
    const categoria = await prisma.categoria.create({
      data: { nome: req.body.nome },
    });
    res.json(categoria);
  } catch (error) {
    console.error("Erro ao criar categoria:", error);
    res.status(500).json({ error: error.message });
  }
});

app.put("/categorias/:id", async (req, res) => {
  try {
    const categoria = await prisma.categoria.update({
      where: { id: Number(req.params.id) },
      data: { nome: req.body.nome },
    });
    res.json(categoria);
  } catch (error) {
    console.error("Erro ao atualizar categoria:", error);
    res.status(500).json({ error: error.message });
  }
});

app.delete("/categorias/:id", async (req, res) => {
  try {
    await prisma.categoria.delete({
      where: { id: Number(req.params.id) },
    });
    res.json({ message: "Categoria deletada" });
  } catch (error) {
    console.error("Erro ao deletar categoria:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/categorias", async (req, res) => {
  try {
    const { nome } = req.query;
    const where = {};

    if (nome) where.nome = { contains: nome };

    const categorias = await prisma.categoria.findMany({
      where,
      orderBy: { nome: "asc" },
    });

    res.json(categorias);
  } catch (error) {
    console.error("Erro ao listar categorias:", error);
    res.status(500).json({ error: error.message });
  }
});

/* =========================
   VENDAS
========================= */

app.post("/vendas", async (req, res) => {
  try {
    const { itens, usuarioId, metodoPag } = req.body;

    console.log("REQ BODY:", req.body);
console.log("METODO RECEBIDO:", metodoPag);

    if (!itens || itens.length === 0) {
      throw new Error("Nenhum item no carrinho");
    }

    let total = 0;
    const itensFormatados = [];

    for (const item of itens) {
      const produto = await prisma.produto.findUnique({
        where: { id: item.id },
      });

      if (!produto) throw new Error(`Produto não encontrado: ${item.id}`);

      total += Number(item.preco) * item.quantidade;

     itensFormatados.push({
  quantidade: item.quantidade,
  preco: Number(item.preco),
  produto: {
    connect: { id: produto.id }
  }
});
    }

    const venda = await prisma.venda.create({
      data: {
        total,
        usuarioId: usuarioId ? Number(usuarioId) : null,
        itens: { create: itensFormatados },
        metodo: metodoPag
      },
      include: { itens: true },
    });

    // estoque
    for (const item of itens) {
      await prisma.produto.update({
        where: { id: item.id },
        data: { estoque: { decrement: item.quantidade } },
      });
    }

    // dívida
    if (usuarioId) {
      await prisma.usuario.update({
        where: { id: Number(usuarioId) },
        data: { divida: { increment: total } },
      });
    }

    res.json(venda);
  } catch (error) {
    console.error("Erro ao criar venda:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/vendas", async (req, res) => {
  try {
    const vendas = await prisma.venda.findMany({
      include: {
        itens: {
          include: { produto: true },
        },
        usuario: true,
      },
      orderBy: { data: "desc" },
    });

    res.json(vendas);
  } catch (error) {
    console.error("Erro ao listar vendas:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/vendas/dia", async (req, res) => {
  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const venda = await prisma.venda.findMany({
      where: {  data: {
      gte: start,
      lte: end,
    }
   },
      include: {
        itens: {
          include: { produto: true },
        },
        usuario: true,
      },
    });

    res.json(venda);
  } catch (error) {
    console.error("Erro ao buscar venda:", error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(3000, () => {
  console.log("Servidor rodando na porta 3000");
});

