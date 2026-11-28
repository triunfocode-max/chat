const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildConversationMessages,
  generateDepartmentReply,
  parseAssistantResponse
} = require('../config/ai-agent');

test('builds a sector-specific prompt from the conversation without customer profile fields', () => {
  const messages = buildConversationMessages({
    departmentName: 'Financeiro',
    instructions: 'Orientar sobre segunda via de boleto.',
    additionalContext: 'Atender em horário comercial.',
    messages: [
      { senderType: 'CUSTOMER', messageText: 'Preciso da segunda via.' },
      { senderType: 'BOT', messageText: 'Posso ajudar.' },
      { senderType: 'SYSTEM', messageText: 'ignorar' }
    ]
  });

  assert.match(messages.systemInstruction.parts[0].text, /Financeiro/);
  assert.match(messages.systemInstruction.parts[0].text, /segunda via de boleto/);
  assert.match(messages.systemInstruction.parts[0].text, /Atender em horário comercial/);
  assert.deepEqual(messages.contents, [
    { role: 'user', parts: [{ text: 'Preciso da segunda via.' }] },
    { role: 'model', parts: [{ text: 'Posso ajudar.' }] }
  ]);
});

test('uses database product data and keeps sales handoff for explicit requests or missing data', () => {
  const messages = buildConversationMessages({
    departmentName: 'Vendas',
    instructions: 'Atender usando o catálogo do banco.',
    products: [{
      sku: 'TEST-001',
      name: 'Produto de teste',
      description: 'Item fictício para validação.',
      price: 12.5,
      stock: 3
    }, {
      sku: 'SKU-REAL',
      name: 'Produto cadastrado',
      description: 'Item cadastrado no catálogo.',
      price: 7.5,
      stock: 4
    }],
    messages: [{ senderType: 'CUSTOMER', messageText: 'Qual é o produto de teste?' }]
  });
  const instructions = messages.systemInstruction.parts[0].text;
  assert.match(instructions, /Produtos ativos do catálogo do banco de dados/);
  assert.match(instructions, /\[DEMONSTRAÇÃO\] TEST-001 \| Produto de teste/);
  assert.match(instructions, /preço: R\$\s*12,50 \| estoque: 3/);
  assert.match(instructions, /SKU-REAL \| Produto cadastrado/);
  assert.match(instructions, /preço: R\$\s*7,50 \| estoque: 4/);
  assert.match(instructions, /não encaminhe automaticamente uma conversa/i);
  assert.match(instructions, /pedir explicitamente um vendedor/i);
  assert.doesNotMatch(instructions, /encaminhe pedidos de compra a um vendedor/i);
  assert.match(instructions, /distribuidora de alimentos/i);
  assert.match(instructions, /estoque representa unidades da embalagem/i);
});

test('builds a greeting prompt for a new conversation without inventing a customer message', () => {
  const prompt = buildConversationMessages({
    departmentName: 'Atendimento',
    instructions: 'Atenda com cordialidade.',
    initialGreeting: true,
    messages: []
  });

  assert.match(prompt.systemInstruction.parts[0].text, /primeira resposta do chamado/i);
  assert.deepEqual(prompt.contents, [{
    role: 'user',
    parts: [{ text: 'O chamado acabou de ser aberto. Inicie a conversa conforme as instruções de saudação.' }]
  }]);
});

test('parses valid replies and rejects malformed provider output', () => {
  assert.deepEqual(
    parseAssistantResponse('{"reply":"Vou encaminhar para o setor.","handoff":true}'),
    { reply: 'Vou encaminhar para o setor.', handoff: true }
  );
  assert.throws(() => parseAssistantResponse('not-json'), /resposta inválida/);
  assert.throws(() => parseAssistantResponse('{"reply":"","handoff":false}'), /resposta inválida/);
});

test('sends sector context to the configured model and returns its reply', async () => {
  const originalFetch = global.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  const previousModel = process.env.GEMINI_MODEL;
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_MODEL = 'test-model';
  let request;
  let requestCount = 0;
  global.fetch = async (url, options) => {
    requestCount += 1;
    request = { url, options };
    if (requestCount === 1) {
      return { ok: false, status: 503 };
    }
    return {
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{"reply":"Olá!","handoff":false}' }] } }]
      })
    };
  };

  try {
    const result = await generateDepartmentReply({
      departmentName: 'Suporte Técnico',
      instructions: 'Ajudar com acesso.',
      additionalContext: 'Atender em horário comercial.',
      initialGreeting: true,
      messages: [{ senderType: 'CUSTOMER', messageText: 'Não consigo entrar.' }]
    });

    assert.deepEqual(result, { reply: 'Olá!', handoff: false });
    assert.equal(requestCount, 2);
    assert.equal(
      request.url,
      'https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent'
    );
    assert.equal(request.options.headers['x-goog-api-key'], 'test-key');
    const body = JSON.parse(request.options.body);
    assert.match(body.systemInstruction.parts[0].text, /Suporte Técnico/);
    assert.match(body.systemInstruction.parts[0].text, /Atender em horário comercial/);
    assert.match(body.systemInstruction.parts[0].text, /primeira resposta do chamado/i);
    assert.equal(body.contents[0].role, 'user');
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
  } finally {
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = previousModel;
  }
});

