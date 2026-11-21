const DEFAULT_DEPARTMENT_GUIDANCE = {
  1: 'Receba o colaborador com cordialidade, entenda o motivo do contato e encaminhe ao setor correto quando necessário. Peça somente as informações essenciais e não prometa prazos sem confirmação.',
  2: 'Ajude com dúvidas financeiras gerais e explique os próximos passos com clareza. Nunca solicite senhas, códigos de segurança ou dados completos de cartão. Não invente saldos, pagamentos, valores ou prazos; encaminhe consultas de conta para um atendente.',
  3: 'Colete o nome do sistema ou equipamento, o erro apresentado e os passos que já foram tentados. Sugira apenas verificações básicas e seguras. Nunca solicite senhas ou códigos de acesso; encaminhe falhas persistentes para um técnico.',
  4: 'Atenda primeiro as dúvidas de vendas consultando os produtos ativos no catálogo do banco de dados (nome, descrição, preço e estoque). Ajude a comparar itens e continue o atendimento mesmo quando o colaborador demonstrar intenção de compra. Não invente produtos, descontos, prazos ou disponibilidade, nem confirme ou registre pedidos. Transfira para um vendedor somente se o colaborador pedir explicitamente ou se a informação necessária não estiver no catálogo e você não puder responder com segurança.'
};

const LEGACY_DEFAULT_SALES_GUIDANCE = 'Ajude com informações dos produtos de teste cadastrados no catálogo. Informe preços e estoque somente conforme o catálogo e identifique-os como dados de demonstração. Não invente produtos, descontos, prazos ou disponibilidade; encaminhe pedidos de compra e dúvidas fora do catálogo para um vendedor.';
const DEFAULT_NEW_DEPARTMENT_GUIDANCE = 'Atenda com cordialidade, use somente informações confirmadas e encaminhe para uma pessoa quando faltar informação ou for necessária uma decisão.';

const TEST_SALES_PRODUCTS = [
  {
    sku: 'TEST-MON-24',
    name: 'Monitor Vista 24',
    description: 'Monitor de demonstração de 24 polegadas, resolução Full HD e conexão HDMI.',
    price: 799.9,
    stock: 8,
    active: true
  },
  {
    sku: 'TEST-ERG-01',
    name: 'Cadeira Ergo Fit',
    description: 'Cadeira de escritório de demonstração com altura ajustável e apoio lombar.',
    price: 649.5,
    stock: 5,
    active: true
  },
  {
    sku: 'TEST-TEC-01',
    name: 'Teclado Compacto',
    description: 'Teclado USB compacto de demonstração com layout ABNT2.',
    price: 89.9,
    stock: 20,
    active: true
  },
  {
    sku: 'TEST-KIT-01',
    name: 'Kit Escritório Start',
    description: 'Kit de demonstração com teclado compacto, mouse USB e mousepad.',
    price: 129.9,
    stock: 12,
    active: true
  }
];

module.exports = {
  DEFAULT_DEPARTMENT_GUIDANCE,
  LEGACY_DEFAULT_SALES_GUIDANCE,
  DEFAULT_NEW_DEPARTMENT_GUIDANCE,
  TEST_SALES_PRODUCTS
};
