// Sonda: ¿a Better Auth le importa el FORMATO del id de usuario?
// Se crea un usuario nativo, se le reescribe el id a un UUID canónico y se
// intenta entrar. Si entra, el gate 6 pasa por la vía "impón el UUID en el
// INSERT de la migración"; si no, hay que buscar qué más espera Better Auth.
import auth, { pool } from './auth.config.mjs'

await pool.query('delete from public."user" where email=$1', ['prueba-id-2@a.test'])
const r = await auth.api.signUpEmail({
  body: { email: 'prueba-id-2@a.test', name: 'Prueba', password: 'Prueba#2026' },
})
const idNativo = r.user.id
const UUID = 'aaaabbbb-cccc-dddd-eeee-000000000001'

await pool.query('update public."user" set id=$1 where id=$2', [UUID, idNativo])
await pool.query('update public.account set "userId"=$1 where "userId"=$2', [UUID, idNativo])
await pool.query('update public.session set "userId"=$1 where "userId"=$2', [UUID, idNativo])

try {
  const s = await auth.api.signInEmail({ body: { email: 'prueba-id-2@a.test', password: 'Prueba#2026' } })
  console.log('signIn con id-UUID → OK', JSON.stringify(s.user))
} catch (e) {
  console.log('signIn con id-UUID FALLA →', e?.message ?? e?.code ?? String(e))
}

// Y la comparaci6n lado a lado: qué distingue a la fila sembrada a mano.
const q = await pool.query(
  'select u.id, u.email, a."providerId", a."accountId", a."userId", left(a.password,4) as pwd, a."accessToken" is null as tok_null from public."user" u left join public.account a on a."userId"=u.id where u.email in ($1,$2) order by u.email',
  ['cliente.viejo@a.test', 'prueba-id-2@a.test'],
)
console.log(JSON.stringify(q.rows, null, 1))
await pool.end()
