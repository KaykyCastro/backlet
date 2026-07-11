import express from "express";
import prisma from "./src/lib/prisma.js";
import dotenv from "dotenv";
import cors from "cors";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import multer from "multer";
import { createSign } from "crypto";
import { fileURLToPath } from "url";
import { getPrecoComDesconto } from "./src/lib/product-helper.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const upload = multer({ dest: "uploads/" });

const DB_PATH = path.join(__dirname, "database.db");

app.use(cors());
app.use(express.json());

const privateKey = fs.readFileSync("private-key.pem", "utf-8");

/**
 * 🔥 FIX PRINCIPAL: desconto sempre number ou null
 */
function parseDesconto(input) {
  if (input === undefined || input === null || input === "") {
    return { desconto: null, tipoDesconto: null };
  }

  const texto = String(input).trim();

  // percentual
  if (texto.endsWith("%")) {
    const valor = Number(texto.replace("%", "").replace(",", "."));
    if (isNaN(valor) || valor <= 0) {
      return { desconto: null, tipoDesconto: null };
    }
    return { desconto: valor, tipoDesconto: "percentual" };
  }

  // valor fixo
  const valor = Number(texto.replace(",", "."));
  if (isNaN(valor) || valor <= 0) {
    return { desconto: null, tipoDesconto: null };
  }

  return { desconto: valor, tipoDesconto: "valor" };
}

// ---------------- AUTH ----------------

app.post("/auth", express.text(), (req, res) => {
  const signer = createSign("SHA512");
  signer.update(req.body);
  signer.end();

  res.send(signer.sign(privateKey, "base64"));
});

// ---------------- BACKUP ----------------

app.get("/backup", (req, res) => {
  const DB_SOURCE = path.resolve(__dirname, "database.db");
  const backupTempPath = path.resolve(__dirname, "temp-backup.db");

  const db = new Database(DB_SOURCE);

  db.backup(backupTempPath)
    .then(() => {
      res.download(backupTempPath, "backup.db", () => {
        db.close();
        if (fs.existsSync(backupTempPath)) fs.unlinkSync(backupTempPath);
      });
    })
    .catch((err) => {
      console.error(err);
      res.status(500).send("Erro backup");
    });
});

// ---------------- RESTORE ----------------

app.post("/restore", upload.single("backup"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Arquivo não enviado" });

  try {
    await prisma.$disconnect();

    const backupDb = new Database(req.file.path);
    await backupDb.backup(DB_PATH);
    backupDb.close();

    fs.unlinkSync(req.file.path);

    await prisma.$connect();

    res.json({ message: "Restore feito" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Falha restore" });
  }
});

// ================= USUARIOS =================

app.post("/usuarios", async (req, res) => {
  try {
    const { nome, cpf, telefone, endereco, divida } = req.body;

    const usuario = await prisma.usuario.create({
      data: {
        nome: nome.trim(),
        cpf: cpf ? cpf.trim() : null,
        telefone: telefone ? telefone.trim() : null,
        endereco: endereco.trim(),
        divida: Number(divida) || 0,
      },
    });

    res.json(usuario);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/usuarios/:id", async (req, res) => {
  try {
    const { nome, cpf, telefone, endereco, divida } = req.body;

    const usuario = await prisma.usuario.update({
      where: { id: Number(req.params.id) },
      data: {
        nome: nome.trim(),
        cpf: cpf ? cpf.trim() : null,
        telefone: telefone ? telefone.trim() : null,
        endereco: endereco.trim(),
        divida: Number(divida) || 0,
      },
    });

    res.json(usuario);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/usuarios", async (req, res) => {
  try {
    const usuarios = await prisma.usuario.findMany({
      include: {
        pagamentos: true,
        vendas: {
          include: {
            itens: {
              include: { produto: true },
            },
          },
        },
      },
      orderBy: { nome: "asc" },
    });

    res.json(usuarios);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/usuarios/:id", async (req, res) => {
  try {
    await prisma.usuario.delete({
      where: { id: Number(req.params.id) },
    });

    res.json({ message: "Cliente deletado" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------- VENDAS DO USUÁRIO ----------------

app.get("/usuarios/:id/vendas", async (req, res) => {
  try {
    const vendas = await prisma.venda.findMany({
      where: {
        usuarioId: Number(req.params.id),
        metodo: "FIADO",
      },
      include: {
        itens: {
          include: { produto: true },
        },
      },
      orderBy: { data: "desc" },
    });

    res.json(vendas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------- PAGAMENTOS ----------------

app.get("/usuarios/:id/pagamentos", async (req, res) => {
  try {
    const pagamentos = await prisma.pagamento.findMany({
      where: { usuarioId: Number(req.params.id) },
      orderBy: { data: "desc" },
    });

    res.json(pagamentos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/usuarios/:id/pagamentos", async (req, res) => {
  try {
    const usuarioId = Number(req.params.id);
    const { valor } = req.body;

    const valorNum = Number(valor);
    if (isNaN(valorNum) || valorNum <= 0) {
      return res.status(400).json({ error: "Valor de pagamento inválido" });
    }

    const resultado = await prisma.$transaction(async (tx) => {
      const usuarioAtual = await tx.usuario.findUnique({
        where: { id: usuarioId },
      });

      if (!usuarioAtual) {
        throw new Error("Cliente não encontrado");
      }

      const pagamento = await tx.pagamento.create({
        data: {
          valor: valorNum,
          usuarioId,
        },
      });

      const novaDivida = Math.max(0, Number(usuarioAtual.divida) - valorNum);

      await tx.usuario.update({
        where: { id: usuarioId },
        data: { divida: novaDivida },
      });

      return pagamento;
    });

    res.json(resultado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ================= PRODUTOS =================

app.post("/produtos", async (req, res) => {
  try {
    const { desconto, tipoDesconto } = parseDesconto(req.body.desconto);

    const produto = await prisma.produto.create({
      data: {
        nome: req.body.nome,
        code: req.body.code,
        preco: Number(req.body.preco),
        estoque: Number(req.body.estoque),
        categoriaId: Number(req.body.categoriaId),
        desconto,
        tipoDesconto,
      },
    });

    res.json(produto);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/produtos/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { nome, code, preco, estoque, categoriaId, desconto: descInput } = req.body;

    const { desconto, tipoDesconto } = parseDesconto(descInput);

    const produto = await prisma.produto.update({
      where: { id: Number(id) },
      data: {
        nome,
        code,
        preco: Number(preco),
        estoque: Number(estoque),
        desconto,
        tipoDesconto,
        categoria: {
          connect: { id: Number(categoriaId) },
        },
      },
    });

    res.json(produto);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/produtos/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.produto.delete({
      where: { id: Number(id) },
    });

    res.json({ message: "Produto deletado" });
  } catch (err) {
    console.error(err);

    // Erro do Prisma quando o produto tem vendas associadas (FK constraint)
    if (err.code === "P2003" || err.code === "P2014") {
      return res.status(400).json({
        error: "Não é possível deletar este produto pois ele já foi vendido em alguma venda.",
      });
    }

    res.status(500).json({ error: err.message });
  }
});

app.get("/produtos", async (req, res) => {
  try {
    const produtos = await prisma.produto.findMany({
      include: { categoria: true },
      orderBy: { nome: "asc" },
    });

    const formatados = produtos.map((p) => ({
      ...p,
      precoComDesconto: getPrecoComDesconto(p),
    }));

    res.json(formatados);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ================= VENDAS =================

app.post("/vendas", async (req, res) => {
  try {
    const { itens, usuarioId, metodoPag } = req.body;

    if (!itens || itens.length === 0) {
      return res.status(400).json({ error: "Carrinho vazio" });
    }

    let total = 0;
    const itensFormatados = [];

    for (const item of itens) {
      const produto = await prisma.produto.findUnique({ where: { id: item.id } });
      if (!produto) {
        return res.status(400).json({ error: `Produto ${item.id} não encontrado` });
      }

      total += Number(item.preco) * item.quantidade;
      itensFormatados.push({
        quantidade: item.quantidade,
        preco: Number(item.preco),
        produto: { connect: { id: produto.id } },
      });
    }

    const venda = await prisma.$transaction(async (tx) => {
      const novaVenda = await tx.venda.create({
        data: {
          total,
          usuarioId: usuarioId ? Number(usuarioId) : null,
          metodo: metodoPag,
          itens: { create: itensFormatados },
        },
      });

      // Se for fiado e tiver cliente vinculado, soma na dívida do cliente
      if (metodoPag === "FIADO" && usuarioId) {
        await tx.usuario.update({
          where: { id: Number(usuarioId) },
          data: { divida: { increment: total } },
        });
      }

      // Abate estoque dos produtos vendidos
      for (const item of itens) {
        await tx.produto.update({
          where: { id: item.id },
          data: { estoque: { decrement: item.quantidade } },
        });
      }

      return novaVenda;
    });

    res.json(venda);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ================= CATEGORIAS =================

app.get("/categorias", async (req, res) => {
  try {
    const categorias = await prisma.categoria.findMany({
      orderBy: { nome: "asc" },
    });
    res.json(categorias);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/categorias", async (req, res) => {
  try {
    const { nome } = req.body;

    if (!nome || !nome.trim()) {
      return res.status(400).json({ error: "Nome da categoria é obrigatório" });
    }

    const categoria = await prisma.categoria.create({
      data: { nome: nome.trim() },
    });

    res.json(categoria);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/categorias/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.categoria.delete({
      where: { id: Number(id) },
    });

    res.json({ message: "Categoria deletada" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ================= SERVER =================

app.listen(3000, () => {
  console.log("Servidor rodando na porta 3000");
});