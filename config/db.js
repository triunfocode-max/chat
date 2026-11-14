const firebird = require('node-firebird');

const options = {
  host: process.env.FB_HOST || '127.0.0.1',
  port: Number(process.env.FB_PORT || 3050),
  database: process.env.FB_DATABASE || 'C:/firebird/data/chat.fdb',
  user: process.env.FB_USER || 'SYSDBA',
  password: process.env.FB_PASSWORD || 'masterkey',
  lowercase_keys: false,
  role: null
};

function getConnection() {
  return new Promise((resolve, reject) => {
    firebird.attachOrCreate(options, (err, db) => {
      if (err) {
        return reject(err);
      }

      resolve(db);
    });
  });
}

async function query(sql, params = []) {
  const db = await getConnection();

  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, result) => {
      db.detach();

      if (err) {
        return reject(err);
      }

      resolve(result || []);
    });
  });
}

async function execute(sql, params = []) {
  const db = await getConnection();

  return new Promise((resolve, reject) => {
    db.execute(sql, params, (err, result) => {
      db.detach();

      if (err) {
        return reject(err);
      }

      resolve(result || []);
    });
  });
}

module.exports = {
  options,
  getConnection,
  query,
  execute
};
