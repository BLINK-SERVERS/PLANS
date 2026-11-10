// Vuelco completo de una JWT nuestra: header, payload y lo que espera la Data API.
const A =
  process.env.AUTH_FN ??
  'https://br-quiet-star-beinsyb9-blinkauth.compute.c-9.us-east-2.aws.neon.tech'
const base = { origin: A, 'content-type': 'application/json' }
const si = await fetch(`${A}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: base,
  body: JSON.stringify({ email: 'cliente.viejo@a.test', password: 'Clave#Vieja2026' }),
})
const cookie = (si.headers.getSetCookie() ?? []).map((c) => c.split(';')[0]).join('; ')
const jwt = (await fetch(`${A}/api/auth/token`, { headers: { ...base, cookie } }).then((r) => r.json())).token
const partes = jwt.split('.')
console.log('segmentos de la JWT:', partes.length)
console.log('header :', Buffer.from(partes[0], 'base64url').toString('utf8'))
console.log('payload:', Buffer.from(partes[1], 'base64url').toString('utf8'))
console.log('firma  :', partes[2]?.length, 'chars')
