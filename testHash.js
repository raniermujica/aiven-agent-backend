import bcrypt from 'bcryptjs';

const password = 'superadmin123';

console.log('Generando hash para password:', password);

bcrypt.hash(password, 10, (err, hash) => {
  if (err) {
    console.error('Error:', err);
    return;
  }
  
  console.log('\n✅ Hash generado:');
  console.log(hash);
  
  // Verificar que funciona
  bcrypt.compare(password, hash, (err, result) => {
    console.log('\n✅ Verificación:', result);
    console.log('\n📋 Ejecuta este SQL en Supabase:');
    console.log(`\nUPDATE restaurant_users`);
    console.log(`SET password_hash = '${hash}'`);
    console.log(`WHERE email = 'superadmin@sistema.com';`);
  });
});