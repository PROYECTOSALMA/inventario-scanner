# Inventario Scanner

Proyecto independiente para conteo movil por scanner.

## URLs de tienda

En Vercel quedaran asi:

- `/elite`
- `/lineas-originales`
- `/club-jeans`
- `/miguel-aleman`
- `/almacen-general`
- `/zapotlanejo`
- `/denim-click`

En local tambien puedes usar:

- `http://localhost:4173/index.html?tienda=elite`
- `http://localhost:4173/index.html?tienda=lineas-originales`
- `http://localhost:4173/index.html?tienda=club-jeans`
- `http://localhost:4173/index.html?tienda=miguel-aleman`
- `http://localhost:4173/index.html?tienda=almacen-general`
- `http://localhost:4173/index.html?tienda=zapotlanejo`
- `http://localhost:4173/index.html?tienda=denim-click`

## Probar local

```bash
npm run dev
```

Abre `http://localhost:4173/index.html?tienda=elite`.

## Supabase

1. Crea un proyecto nuevo en Supabase.
2. Ve a SQL Editor.
3. Pega y ejecuta `supabase/schema.sql`.
4. Copia Project URL y anon public key.
5. En Vercel agrega variables de entorno:

```text
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_ANON_KEY=TU_SUPABASE_ANON_KEY
```

Si Supabase no esta configurado, la app sigue funcionando y guarda conteos en el navegador del dispositivo.

## Conteos simultaneos

Todas las sucursales usan el mismo catalogo de codigos en `data.js`, pero cada liga guarda su propio conteo por tienda.

Durante el escaneo, la captura se guarda primero en el dispositivo para que sea rapida en movil y PC. Al presionar **Finalizar conteo**, se genera el PDF y se manda el cierre completo a Supabase, separado por `store_slug`.

## GitHub y Vercel

```bash
git init
git add .
git commit -m "Initial inventory scanner"
```

Sube este repo a GitHub y conectalo en Vercel como proyecto nuevo.

Build command:

```bash
npm run build
```

Output directory:

```text
dist
```

## Cargar datos reales

Edita `data.js`.

- `catalog`: codigos del PDF, nombre de calidad y calidad consolidada.
- `expectedByQuality`: inventario esperado por tienda y calidad.

Ejemplo:

```js
{ code: '0501', qualityName: 'Jeans modelo 0501', systemQuality: 'Linea' }
```

## Uso

1. Abre la liga de la tienda.
2. Escanea el codigo.
3. Automaticamente aparece la pantalla para capturar piezas.
4. Captura cantidad y confirma.
5. Si aparece el mismo codigo otra vez, suma otro movimiento al mismo total.
6. Corrige errores en Historial antes de finalizar.
7. Al finalizar, genera PDF y el cierre ya no se puede modificar.
