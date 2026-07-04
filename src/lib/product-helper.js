export function getPrecoComDesconto(produto) {
  if (!produto.desconto) return null;
  return Number((produto.preco * (1 - produto.desconto / 100)).toFixed(2));
}