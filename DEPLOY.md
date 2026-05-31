# Deploy de Inventario Scanner

## 1. Supabase

1. Entra a https://supabase.com/dashboard.
2. Crea un proyecto nuevo, por ejemplo `inventario-scanner`.
3. Abre `SQL Editor`.
4. Copia todo el contenido de `supabase/schema.sql`.
5. Pegalo y ejecutalo con `Run`.
6. En `Project Settings` > `API`, copia estos dos datos:
   - `Project URL`
   - `anon public key`

## 2. GitHub

1. Crea un repositorio nuevo en GitHub, por ejemplo `inventario-scanner`.
2. En PowerShell, desde esta carpeta, conecta y sube el proyecto:

```powershell
cd C:\Users\Deminclik\Downloads\inventario-scanner
git remote add origin https://github.com/TU_USUARIO/inventario-scanner.git
git branch -M main
git push -u origin main
```

Si ya existe el remote:

```powershell
git remote set-url origin https://github.com/TU_USUARIO/inventario-scanner.git
git push -u origin main
```

## 3. Vercel

1. Entra a https://vercel.com/new.
2. Importa el repositorio `inventario-scanner` desde GitHub.
3. Usa esta configuracion:
   - Framework Preset: `Other`
   - Build Command: `npm run build`
   - Output Directory: `dist`
4. Agrega estas variables de entorno:
   - `SUPABASE_URL`: el `Project URL` de Supabase
   - `SUPABASE_ANON_KEY`: el `anon public key` de Supabase
5. Presiona `Deploy`.

## 4. URLs de tienda

Cuando Vercel termine, reemplaza `TU-DOMINIO.vercel.app` por el dominio real:

```text
https://TU-DOMINIO.vercel.app/elite
https://TU-DOMINIO.vercel.app/lineas-originales
https://TU-DOMINIO.vercel.app/club-jeans
https://TU-DOMINIO.vercel.app/miguel-aleman
https://TU-DOMINIO.vercel.app/almacen-general
https://TU-DOMINIO.vercel.app/zapotlanejo
https://TU-DOMINIO.vercel.app/denim-click
```

## 5. Prueba rapida

1. Abre una URL de tienda en el celular.
2. Escanea un codigo.
3. Debe aparecer la pantalla para poner piezas.
4. Finaliza un conteo de prueba.
5. En Supabase, revisa la tabla `inventory_counts`.
