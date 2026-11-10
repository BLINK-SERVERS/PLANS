// Sonda de adjudicación: ¿ve el adapter de Better Auth la fila sembrada a mano
// y por qué el sign-in dice "User not found"? Se consulta el adapter directo,
// sin pasar por el endpoint, y se comparan las dos filas lado a lado.
import auth, { pool } from './auth.config.mjs'

const ctx = await auth.$context
console.log('tabla user resuelta →', ctx.options.user?.tableName ?? '(por defecto)', '| schema:', ctx.options.database?.schemaName ?? '(ninguno)')

const buscar = async (email) => {
  const r = await ctx.adapter.findMany({
    model: 'user',
    where: [{ field: 'email', value: email, operator: 'eq' }],
  })
  return r
}

for (const email of ['nativo@a.test', 'cliente.viejo@a.test']) {
  const r = await buscar(email)
  console.log(`adapter.findMany(${email}) → ${r?.length ?? 0} fila(s)`, JSON.stringify(r?.[0] ?? null).slice(0, 220))
}

const bruto = await pool.query(
  `select u.id, length(u.id) as largo_id, u.email, a."providerId", a."accountId", left(a.password,7) as pwd
     from public."user" u left join public.account a on a."userId" = u.id
    order by u."createdAt"`,
)
console.log(JSON.stringify(bruto.rows, null, 1))
await pool.end()
