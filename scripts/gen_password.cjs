const bcrypt = require('bcryptjs');
const newPassword = 'admin' + Math.random().toString(36).slice(2, 10);
bcrypt.hash(newPassword, 12).then(hash => {
  console.log('New password:', newPassword);
  console.log('Hash:', hash);
  process.exit(0);
});
