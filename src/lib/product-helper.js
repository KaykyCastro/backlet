export function getPrecoComDesconto(produto) {
  if (!produto.desconto) return null;

  const valorDesconto = Number(produto.desconto);
  if (isNaN(valorDesconto) || valorDesconto <= 0) return null;

  if (produto.tipoDesconto === "percentual") {
    const precoComDesconto = produto.preco * (1 - valorDesconto / 100);
    return Number(precoComDesconto.toFixed(2));
  }

  const precoComDesconto = produto.preco - valorDesconto;
  return Number(Math.max(0, precoComDesconto).toFixed(2));
}