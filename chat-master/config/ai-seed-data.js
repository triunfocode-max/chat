const DEFAULT_DEPARTMENT_GUIDANCE = {
  1: 'Receba o cliente com cordialidade, entenda o motivo do contato e encaminhe ao setor correto quando necessário. Peça somente as informações essenciais e não prometa prazos sem confirmação.',
  2: 'Ajude com dúvidas financeiras gerais e explique os próximos passos com clareza. Nunca solicite senhas, códigos de segurança ou dados completos de cartão. Não invente saldos, pagamentos, valores ou prazos; encaminhe consultas de conta para um atendente.',
  3: 'Colete o nome do sistema ou equipamento, o erro apresentado e os passos que já foram tentados. Sugira apenas verificações básicas e seguras. Nunca solicite senhas ou códigos de acesso; encaminhe falhas persistentes para um técnico.',
  4: 'Atenda clientes de uma distribuidora de alimentos consultando os produtos ativos no catálogo do banco de dados. Informe apenas nome, embalagem, preço e estoque que estiverem cadastrados. Considere o estoque em unidades da embalagem descrita; não converta para caixas ou fardos. Confirme a quantidade desejada quando necessário. Não invente marcas, preços, descontos, pedido mínimo, validade, disponibilidade ou prazo de entrega; não confirme nem registre pedidos. Transfira para um vendedor somente se o cliente pedir explicitamente ou se a informação necessária não estiver no catálogo e você não puder responder com segurança.',
  5: 'Atenda solicitações sobre pedidos com cordialidade. Peça o número do pedido e os detalhes essenciais para localizar o caso, mas não informe status, itens, valores ou prazos sem dados confirmados. Não registre nem confirme alterações de pedido; encaminhe para um atendente quando for necessária consulta ou decisão humana.',
  6: 'Atenda dúvidas sobre logística e entregas com cordialidade. Peça o número do pedido e a cidade quando isso ajudar a localizar a solicitação. Não invente rotas, rastreamento, disponibilidade ou prazos de entrega; encaminhe para a equipe de logística quando não houver informação confirmada.'
};

const DEFAULT_ADDITIONAL_DEPARTMENTS = [
  { name: 'Pedidos', instructions: DEFAULT_DEPARTMENT_GUIDANCE[5] },
  { name: 'Logística e Entregas', instructions: DEFAULT_DEPARTMENT_GUIDANCE[6] }
];

const LEGACY_DEFAULT_SALES_GUIDANCE = 'Ajude com informações dos produtos de teste cadastrados no catálogo. Informe preços e estoque somente conforme o catálogo e identifique-os como dados de demonstração. Não invente produtos, descontos, prazos ou disponibilidade; encaminhe pedidos de compra e dúvidas fora do catálogo para um vendedor.';
const PREVIOUS_DEFAULT_SALES_GUIDANCE = 'Atenda primeiro as dúvidas de vendas consultando os produtos ativos no catálogo do banco de dados (nome, descrição, preço e estoque). Ajude a comparar itens e continue o atendimento mesmo quando o colaborador demonstrar intenção de compra. Não invente produtos, descontos, prazos ou disponibilidade, nem confirme ou registre pedidos. Transfira para um vendedor somente se o colaborador pedir explicitamente ou se a informação necessária não estiver no catálogo e você não puder responder com segurança.';
const DEFAULT_NEW_DEPARTMENT_GUIDANCE = 'Atenda com cordialidade, use somente informações confirmadas e encaminhe para uma pessoa quando faltar informação ou for necessária uma decisão.';

const TEST_SALES_PRODUCTS = [
  {
    sku: 'TEST-RICE-5KG',
    name: 'Arroz tipo 1 5 kg',
    description: 'Pacote de demonstração de arroz tipo 1, peso líquido de 5 kg.',
    price: 29.9,
    stock: 120,
    active: true
  },
  {
    sku: 'TEST-BEAN-1KG',
    name: 'Feijão carioca 1 kg',
    description: 'Pacote de demonstração de feijão carioca tipo 1, peso líquido de 1 kg.',
    price: 8.9,
    stock: 240,
    active: true
  },
  {
    sku: 'TEST-OIL-900ML',
    name: 'Óleo de soja 900 ml',
    description: 'Garrafa de demonstração de óleo de soja, conteúdo de 900 ml.',
    price: 6.5,
    stock: 180,
    active: true
  },
  {
    sku: 'TEST-MILK-1L',
    name: 'Leite UHT integral 1 L',
    description: 'Unidade de demonstração de leite UHT integral, embalagem de 1 litro.',
    price: 5.2,
    stock: 96,
    active: true
  },
  {
    sku: 'TEST-SUGAR-5KG',
    name: 'Açúcar cristal 5 kg',
    description: 'Pacote de demonstração de açúcar cristal, peso líquido de 5 kg.',
    price: 19.9,
    stock: 72,
    active: true
  }
];

module.exports = {
  DEFAULT_DEPARTMENT_GUIDANCE,
  DEFAULT_ADDITIONAL_DEPARTMENTS,
  LEGACY_DEFAULT_SALES_GUIDANCE,
  PREVIOUS_DEFAULT_SALES_GUIDANCE,
  DEFAULT_NEW_DEPARTMENT_GUIDANCE,
  TEST_SALES_PRODUCTS
};
