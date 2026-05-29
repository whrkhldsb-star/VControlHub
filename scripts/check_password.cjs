const bcrypt = require('bcryptjs');
const hash = '$2b$12$D9b3H6tAeRN7SykcFaof9ejISTPazIzzFa8BseeIyxyiDw0qsxQ26';
const password = '0+LrKuIzTLHK4y9IAFBHDMzcGb4YxIjx';
bcrypt.compare(password, hash).then(r => { console.log('Match:', r); process.exit(r ? 0 : 1); });
