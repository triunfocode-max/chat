const storage = (process.env.STORAGE || 'memory').toLowerCase();

if (storage === 'memory') {
  console.log('Armazenamento em memória ativado; os dados serão perdidos ao reiniciar o servidor.');
  module.exports = require('./memory-store');
} else if (storage === 'supabase') {
  module.exports = require('./supabase-store');
} else {
  throw new Error(`Armazenamento inválido: ${storage}. Use "memory" ou "supabase".`);
}
 

