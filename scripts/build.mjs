import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'

const files = ['index.html', 'styles.css', 'app.js', 'data.js']
const dist = new URL('../dist/', import.meta.url)

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })

await Promise.all(files.map(file => copyFile(new URL(`../${file}`, import.meta.url), new URL(file, dist))))

const config = `window.INVENTORY_CONFIG = {
  supabaseUrl: ${JSON.stringify(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '')},
  supabaseAnonKey: ${JSON.stringify(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '')},
}
`

await writeFile(new URL('config.js', dist), config)
