# Multi-atendimento Web em Node.js + Socket.io

## Estrutura base do projeto

- `sql/firebird_schema.sql` — script de criação do banco Firebird.
- `sql/supabase_schema.sql` — script de criação do schema PostgreSQL no Supabase.
- `config/db.js` — configuração da conexão com Firebird via `node-firebird`.
- `config/supabase-store.js` — persistência PostgreSQL usada pelo Supabase.
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

## Usar Supabase (opcional)

1. Crie um projeto no Supabase e abra o **SQL Editor**.
2. Execute o conteúdo de `sql/supabase_schema.sql`.
3. No painel do Supabase, abra **Connect** e copie a string PostgreSQL de **Session pooler** ou **Direct connection**. Para servidores em redes somente IPv4, use o Session pooler. Substitua `[YOUR-PASSWORD]` pela senha do banco e configure as variáveis no ambiente do servidor:

```env
STORAGE=supabase
SUPABASE_DB_URL=postgresql://postgres.[PROJECT-REF]:[PASSWORD]@[POOLER-HOST]:5432/postgres
SUPABASE_CA_CERT=
DATA_ENCRYPTION_KEY=
ADMIN_EMAIL=admin@empresa.com
ADMIN_PASSWORD=uma-senha-forte-com-pelo-menos-12-caracteres
AGENTS_JSON=[{"name":"Atendente Financeiro","email":"financeiro@empresa.com","password":"outra-senha-forte-com-pelo-menos-12-caracteres","departmentId":2}]
```

O servidor cria/atualiza as contas configuradas no primeiro início. Em produção, use senhas próprias com pelo menos 12 caracteres; não use os usuários de demonstração. O administrador recebe chamados de todos os setores. Os IDs iniciais são Atendimento `1`, Financeiro `2`, Suporte Técnico `3` e Vendas `4`.

Mantenha `SUPABASE_DB_URL`, `ADMIN_PASSWORD` e as senhas em `AGENTS_JSON` somente nas variáveis privadas do ambiente de execução. Não compartilhe nem publique o `.env`, a senha do banco ou uma chave `service_role`; esta integração usa a conexão PostgreSQL diretamente no servidor.

As conexões usam TLS com validação do certificado. Se o provedor do banco exigir um certificado raiz próprio, informe o caminho do arquivo em `SUPABASE_CA_CERT`. Os chamados, mensagens, clientes e agentes ficam no PostgreSQL. Os tokens de acesso dos colaboradores são armazenados como hashes; o token em texto puro não é gravado no banco. A configuração não importa automaticamente dados de uma instalação anterior do Firebird ou da memória.

### Criptografia e proteção dos dados

No modo Supabase, configure `DATA_ENCRYPTION_KEY` como uma chave Base64 gerada a partir de 32 bytes aleatórios. Gere-a localmente com `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` e cadastre o resultado diretamente como variável privada no Render; não a envie pelo chat, GitHub ou `.env` versionado. Configure e faça backup seguro da chave **antes** do próximo deploy: sem ela o servidor não inicia no modo Supabase. Guarde uma cópia em um gerenciador de segredos seguro. Perder ou substituir a chave sem uma migração de recriptografia torna os dados existentes irrecuperáveis.

Na inicialização, o servidor migra registros existentes e criptografa mensagens, nomes, cargos e telefones dos clientes e nomes e e-mails dos atendentes com AES-256-GCM. Índices HMAC permitem localizar clientes por telefone e atendentes por e-mail sem manter esses valores em texto puro; senhas continuam armazenadas com bcrypt. A migração é repetível e interrompe a inicialização se a chave estiver ausente, incorreta ou os dados não puderem ser decifrados. A aplicação decifra os campos somente no servidor para exibi-los às pessoas autorizadas. Isso protege dados em repouso no banco, não substitui HTTPS nem significa criptografia ponta a ponta.

O servidor também aplica cabeçalhos de segurança, validação de origem nas operações de escrita, limite de tamanho das solicitações e limitação de requisições/login/mensagens. O `.gitignore` exclui arquivos de ambiente, certificados, bancos locais, logs e a pasta de uploads. O sistema ainda não possui envio de anexos; mantenha arquivos privados fora do repositório.

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
- Financeiro: `financeiro@empresa.com` / `financeiro123`
- Suporte Técnico: `suporte@empresa.com` / `suporte12345`
- Vendas: `vendas@empresa.com` / `vendas12345`

Essas credenciais são somente para desenvolvimento local. Em produção, configure `ADMIN_EMAIL` e `ADMIN_PASSWORD` com valores próprios e uma senha de pelo menos 12 caracteres. O painel usa uma sessão protegida por cookie; as rotas dos atendimentos e o chat exigem autenticação.

Na página inicial, o colaborador abre um chamado com nome, cargo, telefone e setor; durante a conversa, também pode encerrá-la ou transferi-la para um atendente de outro setor, com presença online/offline. O atendente recebe avisos na tela e no navegador, pode responder por um atalho, assumir chamados da fila, conversar com o colaborador e transferir chamados para outro setor. As conversas mantêm o histórico ao serem transferidas.

Para configurar os atendentes do modo em memória, defina `AGENTS_JSON` como uma lista JSON de objetos com `name`, `email`, `password` e `departmentId`. Em produção, não há atendentes de demonstração e a senha de cada atendente precisa ter pelo menos 12 caracteres. Por exemplo:

```env
AGENTS_JSON=[{"name":"Atendente Financeiro","email":"financeiro@empresa.com","password":"defina-uma-senha-forte","departmentId":2},{"name":"Atendente de Vendas","email":"vendas@empresa.com","password":"defina-outra-senha-forte","departmentId":4}]
```

Use um e-mail único e uma senha própria de pelo menos 12 caracteres por atendente em produção. Os IDs dos setores iniciais são: Atendimento `1`, Financeiro `2`, Suporte Técnico `3` e Vendas `4`.

## Executando a aplicação

```bash
npm start
```

O sistema estará disponível em:

- Cliente: `http://localhost:3000/`
- Atendente: `http://localhost:3000/admin.html`

## Publicar no Render

Crie um serviço **Web Service** ligado ao repositório do projeto, usando runtime Node, comando de build `npm ci` e comando de início `npm start`. Para manter chamados e mensagens após reinícios, configure `NODE_ENV=production`, `STORAGE=supabase`, `SUPABASE_DB_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` e `AGENTS_JSON` nas variáveis privadas do Render. `ADMIN_PASSWORD` e as senhas dos atendentes precisam ter pelo menos 12 caracteres. Se estiver usando o Supabase, crie o schema antes do primeiro deploy. Não use as contas de demonstração em produção.

Não envie o arquivo local `.env` nem a pasta `node_modules` ao repositório. Após o deploy, compartilhe o endereço do serviço: a tela do colaborador fica na raiz (`/`) e o painel do atendente em `/admin.html`.

O serviço precisa permanecer com uma única instância para que as conexões Socket.IO em tempo real sejam compartilhadas. O Supabase persiste os dados entre reinícios e deploys, mas a presença online e as sessões dos atendentes permanecem em memória no servidor.
