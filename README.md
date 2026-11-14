# Multi-atendimento Web em Node.js + Socket.io

## Estrutura base do projeto

- `sql/firebird_schema.sql` — script de criação do banco Firebird com as tabelas e índices do sistema.
- `config/db.js` — configuração da conexão com Firebird via `node-firebird`.
- `config/memory-store.js` — armazenamento temporário em memória, usado por padrão.
- `server.js` — API Express + Socket.io.
- `public/index.html` — front-end do cliente.
- `public/admin.html` — painel do atendente.
- `public/js/app.js` — lógica da tela do cliente.
- `public/js/admin.js` — lógica do painel do atendente.

## Instalação

1. Instale as dependências:

```bash
npm install
```

2. Inicie o sistema sem banco de dados:

```bash
npm start
```

Por padrão, `STORAGE=memory`: não é necessário instalar ou conectar a um banco. Os setores iniciais e um usuário de demonstração ficam disponíveis automaticamente. Os dados criados durante o uso são mantidos apenas na memória do servidor e são apagados quando ele é reiniciado.

## Usar Firebird (opcional)

Para usar o Firebird, configure o arquivo `.env` com `STORAGE=firebird` e os dados de conexão:

```env
STORAGE=firebird
FB_HOST=127.0.0.1
FB_PORT=3050
FB_DATABASE=C:/firebird/data/chat.fdb
FB_USER=SYSDBA
FB_PASSWORD=masterkey
```

Crie o banco Firebird e execute o script SQL:

```sql
CREATE DATABASE 'C:/firebird/data/chat.fdb' USER 'SYSDBA' PASSWORD 'masterkey';
```

Depois execute o conteúdo do arquivo `sql/firebird_schema.sql` com um cliente Firebird (IBExpert, FlameRobin, isql).

## Usuário de demonstração local

- E-mail: `admin@empresa.com`
- Senha: `admin123`

Essas credenciais são somente para desenvolvimento local. Em produção, configure `ADMIN_EMAIL` e `ADMIN_PASSWORD` com valores próprios e uma senha de pelo menos 12 caracteres. O painel usa uma sessão protegida por cookie; as rotas dos atendimentos e o chat exigem autenticação.

## Executando a aplicação

```bash
npm start
```

O sistema estará disponível em:

- Cliente: `http://localhost:3000/`
- Atendente: `http://localhost:3000/admin.html`

## Publicar no Render

O arquivo `render.yaml` configura o serviço web com Socket.IO, armazenamento em memória e verificação de saúde. Para publicar:

1. Envie somente a pasta deste projeto para um repositório Git seu. Não envie `.env` nem `node_modules` (o `.gitignore` já os exclui).
2. No Render, crie um **Blueprint** e conecte esse repositório; o Render encontrará o `render.yaml`.
3. Quando solicitado, informe `ADMIN_EMAIL` e `ADMIN_PASSWORD` próprios. Em produção, a senha precisa ter pelo menos 12 caracteres; não use as credenciais de demonstração.
4. Após o deploy, compartilhe o endereço do serviço. A tela do cliente fica na raiz (`/`) e o painel fica em `/admin.html`.

O serviço precisa permanecer com uma única instância para que a memória e as conexões em tempo real sejam compartilhadas. O plano gratuito do Render pode suspender o serviço quando estiver ocioso e reiniciá-lo; qualquer reinício ou novo deploy apaga os atendimentos armazenados em memória. Use um banco persistente antes de depender do sistema para guardar atendimentos reais.

## Próximo passo recomendado

- Implementar autenticação por sessão JWT para o painel administrativo.
- Ajustar a fila em tempo real com eventos mais específicos por setor.
- Melhorar a UI do chat com histórico de mensagens e timestamps.
- Adicionar transferências entre departamentos/atendentes.
