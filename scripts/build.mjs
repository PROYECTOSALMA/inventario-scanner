import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'

const files = ['index.html', 'styles.css', 'app.js', 'data.js', 'sw.js']
const dist = new URL('../dist/', import.meta.url)

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })

await Promise.all(files.map(file => copyFile(new URL(`../${file}`, import.meta.url), new URL(file, dist))))

const config = `window.INVENTORY_CONFIG = {
  supabaseUrl: ${JSON.stringify(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '')},
  supabaseAnonKey: ${JSON.stringify(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '')},
  adminPinHash: ${JSON.stringify(process.env.ADMIN_PIN_HASH || process.env.NEXT_PUBLIC_ADMIN_PIN_HASH || '0ab5946ad63b762a4c7ce7f5e9d92bb764e2a10783cbd6ceb9a78a628779dff4')},
}
`

await writeFile(new URL('config.js', dist), config)
