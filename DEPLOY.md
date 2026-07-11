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

## 3. Netlify

1. Entra a Netlify y abre el sitio publicado.
2. Importa o conecta el repositorio `inventario-scanner` desde GitHub.
3. Usa esta configuracion:
   - Framework Preset: `Other`
   - Build Command: `npm run build`
   - Output Directory: `dist`
4. Agrega estas variables de entorno:
   - `SUPABASE_URL`: el `Project URL` de Supabase
   - `SUPABASE_ANON_KEY`: el `anon public key` de Supabase
5. Presiona `Deploy`.

## 4. URLs de tienda

Cuando Netlify termine, reemplaza `TU-DOMINIO.netlify.app` por el dominio real:

```text
https://TU-DOMINIO.netlify.app/elite
https://TU-DOMINIO.netlify.app/lineas-originales
https://TU-DOMINIO.netlify.app/club-jeans
https://TU-DOMINIO.netlify.app/miguel-aleman
https://TU-DOMINIO.netlify.app/almacen-general
https://TU-DOMINIO.netlify.app/zapotlanejo
https://TU-DOMINIO.netlify.app/denim-click
```

## 5. Prueba rapida

1. Abre una URL de tienda en el celular.
2. Escanea un codigo.
3. Debe aparecer la pantalla para poner piezas.
4. Finaliza un conteo de prueba.
5. En Supabase, revisa la tabla `inventory_counts`.

## Dashboard gerencial

El link principal del sitio muestra el dashboard general.

```text
https://TU-DOMINIO.netlify.app/
```

Las tiendas cuentan en sus ligas normales:

```text
https://TU-DOMINIO.netlify.app/elite
```

El gerente puede abrir una tienda en modo solo lectura agregando `?visor=1`:

```text
https://TU-DOMINIO.netlify.app/elite?visor=1
```

Para activar conteo en vivo y carga de stock por archivo, vuelve a ejecutar `supabase/schema.sql` completo en Supabase SQL Editor. Ese archivo crea:

- `inventory_counts`: cierres finales.
- `inventory_active_counts`: conteo activo visible en nube.
- `inventory_store_stocks`: inventario de sistema cargado desde Excel, CSV o PDF, una fila vigente por sucursal.
- `inventory_custom_codes`: codigos nuevos agregados por gerente o durante el escaneo.
- `save_inventory_store_stock`: funcion que guarda cada archivo con hora real de Supabase para que el ultimo archivo recibido sea el vigente.
- `save_inventory_custom_codes`: funcion que guarda codigos nuevos por lotes para que los Excel grandes no se queden leyendo.

Sin `SUPABASE_URL` y `SUPABASE_ANON_KEY` en Netlify, la carga de stock no se comparte entre dispositivos.
