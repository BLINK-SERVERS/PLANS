// Descarte rápido: ¿falla la búsqueda del usuario o la verificación de la
// clave? Se prueban las dos cosas por separado, sin HTTP de por medio.
import auth, { pool } from './auth.config.mjs'
import bcrypt from 'bcryptjs'

const ctx = await auth.$context
const email = 'cliente.viejo@a.test'

const uno = await ctx.adapter.findOne({ model: 'user', where: [{ field: 'email', value: email }] })
console.log('adapter.findOne(user por email) →', uno ? `OK id=${uno.id}` : 'NULL')

const filas = await pool.query(
  'select id, "userId", "providerId", "accountId", password from public.account where "userId"=$1',
  [uno?.id ?? '—'],
)
console.log('account por userId →', JSON.stringify(filas.rows.map((r) => ({ ...r, password: r.password.slice(0, 10) + '…' }))))

for (const f of filas.rows) {
  console.log('bcrypt.compare directo →', await bcrypt.compare('Clave#Vieja2026', f.password))
}

try {
  const s = await ctx.adapter.findOne({
    model: 'account',
    where: [
      { field: 'userId', value: uno?.id },
      { field: 'providerId', value: 'credential' },
    ],
  })
  console.log('adapter.findOne(account) →', s ? `OK id=${s.id}` : 'NULL')
} catch (e) {
  console.log('adapter.findOne(account) ERROR →', e.message)
}

try {
  const r = await auth.api.signInEmail({ body: { email, password: 'Clave#Vieja2026' } })
  console.log('signInEmail interno →', JSON.stringify(r?.user ?? r).slice(0, 160))
} catch (e) {
  console.log('signInEmail interno FALLA →', e?.body?.code ?? e?.message)
}
await pool.end()
