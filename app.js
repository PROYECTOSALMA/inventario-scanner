(function () {
  const data = window.INVENTORY_DATA
  const app = document.querySelector('#app')
  const catalogByCode = new Map(data.catalog.map(item => [normalizeCode(item.code), item]))
  const supabaseClient = createSupabaseClient()

  let store = null
  let activeCount = null
  let pastCounts = []
  let currentTab = 'scan'
  let pendingScan = null
  let editingMovement = null
  let showAllCodes = false
  let historyQuery = ''
  let lastMovementId = ''

  boot()

  function boot() {
    store = getStoreFromUrl()
    if (!store) {
      renderStoreList()
      return
    }

    document.title = `Inventario - ${store.name}`
    activeCount = loadActiveCount(store.slug)
    pastCounts = loadPastCounts(store.slug)
    renderCounter()
    focusScanner()
    fetchRemoteCounts()
  }

  function renderStoreList() {
    const template = document.querySelector('#store-list-template')
    app.replaceChildren(template.content.cloneNode(true))

    const grid = app.querySelector('[data-store-grid]')
    grid.innerHTML = data.stores.map(item => `
      <a class="store-card" href="${escapeHtml(storeUrl(item.slug))}">
        <div>
          <strong>${escapeHtml(item.name)}</strong>
          <span>?tienda=${escapeHtml(item.slug)}</span>
        </div>
        <div class="store-footer">
          <span>Abrir conteo</span>
          <i class="color-dot" style="background:${escapeHtml(item.color)}"></i>
        </div>
      </a>
    `).join('')
  }

  function renderCounter() {
    const template = document.querySelector('#counter-template')
    app.replaceChildren(template.content.cloneNode(true))

    app.querySelector('[data-store-name]').textContent = store.name
    app.querySelector('[data-finalize]').style.background = store.color
    bindCounterEvents()
    updateCounter()
  }

  function bindCounterEvents() {
    app.querySelector('[data-scan-form]').addEventListener('submit', event => {
      event.preventDefault()
      processScan()
    })

    app.querySelector('[data-scan-input]').addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === 'Tab') && event.currentTarget.value.trim()) {
        event.preventDefault()
        processScan()
      }
    })

    app.querySelector('[data-reset]').addEventListener('click', resetActiveCount)
    app.querySelector('[data-finalize]').addEventListener('click', finalizeCount)
    app.querySelector('[data-go-history]').addEventListener('click', () => setTab('history'))
    app.querySelector('[data-show-all]').addEventListener('change', event => {
      showAllCodes = event.currentTarget.checked
      updateCounter()
    })
    app.querySelector('[data-history-search]').addEventListener('input', event => {
      historyQuery = event.currentTarget.value
      updateCounter()
    })

    app.querySelectorAll('[data-tab-button]').forEach(button => {
      button.addEventListener('click', () => setTab(button.dataset.tabButton))
    })

    bindQuantitySheet()
    bindEditSheet()
  }

  function bindQuantitySheet() {
    app.querySelector('[data-close-sheet]').addEventListener('click', closeQuantitySheet)
    app.querySelector('[data-quantity-form]').addEventListener('submit', event => {
      event.preventDefault()
      confirmQuantity()
    })
    app.querySelector('[data-qty-minus]').addEventListener('click', () => bumpQuantity(-1))
    app.querySelector('[data-qty-plus]').addEventListener('click', () => bumpQuantity(1))
    app.querySelectorAll('[data-preset]').forEach(button => {
      button.addEventListener('click', () => {
        app.querySelector('[data-qty-input]').value = button.dataset.preset
        setQtyError('')
      })
    })
    app.querySelector('[data-qty-input]').addEventListener('input', () => setQtyError(''))
  }

  function bindEditSheet() {
    app.querySelector('[data-close-edit]').addEventListener('click', closeEditSheet)
    app.querySelector('[data-edit-form]').addEventListener('submit', event => {
      event.preventDefault()
      saveMovementEdit()
    })
  }

  function updateCounter() {
    const codeTotals = buildCodeTotals(activeCount.movements)
    const comparison = buildComparisonTotals(codeTotals)
    const dashboard = buildDashboard(comparison)
    const countedCodes = codeTotals.filter(row => row.total > 0).length
    const lastMovement = activeCount.movements.find(row => row.id === lastMovementId)

    app.querySelector('[data-count-meta]').textContent = `Inicio ${formatDateTime(activeCount.startedAt)} - ${activeCount.movements.length} movimientos`
    app.querySelector('[data-reset]').disabled = activeCount.movements.length === 0
    app.querySelector('[data-finalize]').disabled = activeCount.movements.length === 0
    app.querySelector('[data-metric-counted]').textContent = formatNumber(dashboard.counted)
    app.querySelector('[data-metric-shortage]').textContent = formatNumber(dashboard.shortage)
    app.querySelector('[data-metric-surplus]').textContent = formatNumber(dashboard.surplus)
    app.querySelector('[data-metric-difference]').textContent = signedNumber(dashboard.difference)
    app.querySelector('[data-progress-text]').textContent = `${formatNumber(dashboard.counted)} piezas en ${formatNumber(countedCodes)} codigos`

    const lastScan = app.querySelector('[data-last-scan]')
    if (lastMovement) {
      lastScan.hidden = false
      lastScan.textContent = `${lastMovement.code} sumo ${formatNumber(lastMovement.quantity)} pz. Total codigo: ${formatNumber(totalForCode(codeTotals, lastMovement.code))} pz`
    } else {
      lastScan.hidden = true
    }

    app.querySelector('[data-code-table]').innerHTML = renderCodeTable(codeTotals.filter(row => showAllCodes || row.total > 0))
    app.querySelector('[data-comparison-table]').innerHTML = renderComparisonTable(comparison.filter(row => showAllCodes || row.counted || row.expected))
    app.querySelector('[data-compact-comparison]').innerHTML = renderComparisonTable(comparison.filter(row => row.counted || row.expected).slice(0, 8), true)
    app.querySelector('[data-recent-movements]').innerHTML = renderMovementList(activeCount.movements.slice(0, 6))
    app.querySelector('[data-history-list]').innerHTML = renderMovementList(filterMovements(activeCount.movements))
    app.querySelector('[data-past-list]').innerHTML = renderPastCounts()

    bindDynamicButtons()
    saveActiveCount()
    savePastCounts()
  }

  function bindDynamicButtons() {
    app.querySelectorAll('[data-edit-movement]').forEach(button => {
      button.addEventListener('click', () => openEditSheet(button.dataset.editMovement))
    })
    app.querySelectorAll('[data-delete-movement]').forEach(button => {
      button.addEventListener('click', () => deleteMovement(button.dataset.deleteMovement))
    })
    app.querySelectorAll('[data-pdf-count]').forEach(button => {
      button.addEventListener('click', () => {
        const count = pastCounts.find(item => item.id === button.dataset.pdfCount)
        if (count) downloadPdf(count)
      })
    })
  }

  function processScan() {
    const input = app.querySelector('[data-scan-input]')
    const rawScan = input.value.trim()
    if (!rawScan) return

    const item = findItemByScan(rawScan)
    input.value = ''
    setScanError('')

    if (!item) {
      lastMovementId = ''
      setScanError(`Codigo no registrado: ${rawScan}`)
      updateCounter()
      focusScanner()
      return
    }

    pendingScan = { item, rawScan }
    openQuantitySheet()
  }

  function openQuantitySheet() {
    const codeTotals = buildCodeTotals(activeCount.movements)
    const sheet = app.querySelector('[data-quantity-sheet]')
    const input = app.querySelector('[data-qty-input]')

    app.querySelector('[data-sheet-code]').textContent = pendingScan.item.code
    app.querySelector('[data-sheet-quality]').textContent = pendingScan.item.qualityName
    app.querySelector('[data-sheet-system]').textContent = `Calidad sistema: ${pendingScan.item.systemQuality}`
    app.querySelector('[data-sheet-current]').textContent = `Total actual: ${formatNumber(totalForCode(codeTotals, pendingScan.item.code))} pz`
    input.value = '1'
    setQtyError('')
    sheet.hidden = false
    window.setTimeout(() => input.select(), 60)
  }

  function closeQuantitySheet() {
    pendingScan = null
    app.querySelector('[data-quantity-sheet]').hidden = true
    focusScanner()
  }

  function confirmQuantity() {
    if (!pendingScan) return

    const quantity = parsePieces(app.querySelector('[data-qty-input]').value)
    if (!quantity) {
      setQtyError('Captura una cantidad valida mayor a cero.')
      return
    }

    const movement = {
      id: createId('mov'),
      code: pendingScan.item.code,
      rawScan: pendingScan.rawScan,
      quantity,
      createdAt: new Date().toISOString(),
    }

    activeCount.movements.unshift(movement)
    lastMovementId = movement.id
    closeQuantitySheet()
    setTab('scan')
    updateCounter()
  }

  function bumpQuantity(delta) {
    const input = app.querySelector('[data-qty-input]')
    const current = parsePieces(input.value) || 0
    input.value = String(Math.max(1, current + delta))
    setQtyError('')
  }

  function openEditSheet(id) {
    const movement = activeCount.movements.find(item => item.id === id)
    if (!movement) return

    const item = getCatalogItem(movement.code)
    editingMovement = movement
    app.querySelector('[data-edit-code]').textContent = movement.code
    app.querySelector('[data-edit-quality]').textContent = item ? item.qualityName : 'Codigo'
    app.querySelector('[data-edit-input]').value = String(movement.quantity)
    app.querySelector('[data-edit-sheet]').hidden = false
    window.setTimeout(() => app.querySelector('[data-edit-input]').select(), 60)
  }

  function closeEditSheet() {
    editingMovement = null
    app.querySelector('[data-edit-sheet]').hidden = true
    focusScanner()
  }

  function saveMovementEdit() {
    if (!editingMovement) return
    const quantity = parsePieces(app.querySelector('[data-edit-input]').value)
    if (!quantity) return

    activeCount.movements = activeCount.movements.map(item => {
      if (item.id !== editingMovement.id) return item
      return { ...item, quantity, updatedAt: new Date().toISOString() }
    })
    closeEditSheet()
    updateCounter()
  }

  function deleteMovement(id) {
    const movement = activeCount.movements.find(item => item.id === id)
    if (!movement) return

    const item = getCatalogItem(movement.code)
    const label = item ? `${item.code} - ${item.qualityName}` : movement.code
    if (!window.confirm(`Eliminar movimiento?\n${label}\n${movement.quantity} pz`)) return

    activeCount.movements = activeCount.movements.filter(item => item.id !== id)
    if (lastMovementId === id) lastMovementId = ''
    updateCounter()
  }

  function resetActiveCount() {
    if (!activeCount.movements.length) return
    if (!window.confirm('Borrar conteo actual y empezar de cero?')) return

    activeCount = createEmptyCount(store.slug)
    lastMovementId = ''
    setTab('scan')
    updateCounter()
    focusScanner()
  }

  function finalizeCount() {
    if (!activeCount.movements.length) return
    if (!window.confirm('Finalizar conteo? Despues del cierre ya no se podra modificar.')) return

    const codeTotals = buildCodeTotals(activeCount.movements)
    const comparison = buildComparisonTotals(codeTotals)
    const finalized = {
      ...activeCount,
      folio: buildFolio(store.slug),
      finalizedAt: new Date().toISOString(),
      codeTotals: codeTotals.filter(row => row.total > 0),
      comparisonTotals: comparison.filter(row => row.counted || row.expected),
      totalPieces: codeTotals.reduce((sum, row) => sum + row.total, 0),
    }

    pastCounts.unshift(finalized)
    pastCounts = pastCounts.slice(0, 80)
    savePastCounts()
    syncFinalizedCount(finalized)
    downloadPdf(finalized)

    activeCount = createEmptyCount(store.slug)
    lastMovementId = ''
    setTab('past')
    updateCounter()
  }

  function setTab(tab) {
    currentTab = tab
    app.querySelectorAll('[data-tab-button]').forEach(button => {
      button.classList.toggle('active', button.dataset.tabButton === tab)
    })
    app.querySelectorAll('[data-tab-panel]').forEach(panel => {
      panel.hidden = panel.dataset.tabPanel !== tab
    })
    focusScanner()
  }

  function renderCodeTable(rows) {
    if (!rows.length) return empty('Sin codigos contados')
    return `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Codigo</th>
              <th>Nombre de la calidad</th>
              <th class="right">Total de pz</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => `
              <tr>
                <td class="mono">${escapeHtml(row.code)}</td>
                <td>${escapeHtml(row.qualityName)}</td>
                <td class="right mono">${formatNumber(row.total)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `
  }

  function renderComparisonTable(rows, compact) {
    if (!rows.length) return empty('Sin comparativo')
    return `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Calidad</th>
              <th class="right">Conteo</th>
              <th class="right">Sistema</th>
              ${compact ? '' : '<th class="right">Faltante</th><th class="right">Sobrante</th>'}
              <th class="right">Dif.</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => `
              <tr>
                <td>${escapeHtml(row.quality)}</td>
                <td class="right mono">${formatNumber(row.counted)}</td>
                <td class="right">${formatNumber(row.expected)}</td>
                ${compact ? '' : `<td class="right">${formatNumber(row.shortage)}</td><td class="right">${formatNumber(row.surplus)}</td>`}
                <td class="right mono">${signedNumber(row.difference)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `
  }

  function renderMovementList(rows) {
    if (!rows.length) return empty('Sin movimientos')

    return rows.map(movement => {
      const item = getCatalogItem(movement.code)
      return `
        <article class="movement">
          <div class="movement-main">
            <div class="movement-title">
              <strong class="mono">${escapeHtml(movement.code)}</strong>
              <span class="pill">${formatNumber(movement.quantity)} pz</span>
              ${movement.updatedAt ? '<span class="pill">corregido</span>' : ''}
            </div>
            <p>${escapeHtml(item ? item.qualityName : 'Codigo no encontrado')}</p>
            <p>${formatTime(movement.createdAt)} - scan: ${escapeHtml(movement.rawScan)}</p>
          </div>
          <div class="movement-actions">
            <button type="button" data-edit-movement="${escapeHtml(movement.id)}" aria-label="Corregir">E</button>
            <button type="button" class="danger" data-delete-movement="${escapeHtml(movement.id)}" aria-label="Eliminar">X</button>
          </div>
        </article>
      `
    }).join('')
  }

  function renderPastCounts() {
    if (!pastCounts.length) return empty('Sin cierres guardados')
    return pastCounts.map(count => `
      <article class="past-card">
        <div>
          <strong class="mono">${escapeHtml(count.folio)}</strong>
          <p class="muted">${formatDateTime(count.finalizedAt)} - ${formatNumber(count.totalPieces)} pz - ${count.movements.length} movimientos</p>
        </div>
        <button type="button" class="primary-button" data-pdf-count="${escapeHtml(count.id)}">PDF</button>
      </article>
    `).join('')
  }

  function empty(text) {
    return `<div class="empty">${escapeHtml(text)}</div>`
  }

  function buildCodeTotals(movements) {
    const totals = new Map()
    movements.forEach(movement => {
      const key = normalizeCode(movement.code)
      totals.set(key, (totals.get(key) || 0) + movement.quantity)
    })

    return data.catalog.map(item => ({
      code: item.code,
      qualityName: item.qualityName,
      systemQuality: item.systemQuality,
      total: totals.get(normalizeCode(item.code)) || 0,
    })).sort((a, b) => a.code.localeCompare(b.code, 'es-MX', { numeric: true }))
  }

  function buildComparisonTotals(codeTotals) {
    const qualities = new Set([
      ...Object.keys(data.expectedByQuality),
      ...data.catalog.map(item => item.systemQuality),
    ])
    const counted = new Map()
    codeTotals.forEach(row => counted.set(row.systemQuality, (counted.get(row.systemQuality) || 0) + row.total))

    return Array.from(qualities).sort((a, b) => a.localeCompare(b)).map(quality => {
      const countedPieces = counted.get(quality) || 0
      const expected = Number((data.expectedByQuality[quality] || {})[store.slug]) || 0
      const difference = countedPieces - expected
      return {
        quality,
        counted: countedPieces,
        expected,
        difference,
        shortage: Math.max(0, expected - countedPieces),
        surplus: Math.max(0, countedPieces - expected),
      }
    })
  }

  function buildDashboard(rows) {
    return rows.reduce((acc, row) => ({
      counted: acc.counted + row.counted,
      expected: acc.expected + row.expected,
      shortage: acc.shortage + row.shortage,
      surplus: acc.surplus + row.surplus,
      difference: acc.difference + row.difference,
    }), { counted: 0, expected: 0, shortage: 0, surplus: 0, difference: 0 })
  }

  function filterMovements(rows) {
    const query = normalizeSearch(historyQuery)
    if (!query) return rows
    return rows.filter(movement => {
      const item = getCatalogItem(movement.code)
      return normalizeSearch(`${movement.code} ${movement.rawScan} ${item ? item.qualityName : ''} ${item ? item.systemQuality : ''}`).includes(query)
    })
  }

  function findItemByScan(rawScan) {
    const scan = normalizeCode(rawScan)
    if (!scan) return null

    const entries = data.catalog
      .map(item => ({ item, code: normalizeCode(item.code) }))
      .sort((a, b) => b.code.length - a.code.length)

    const exact = entries.find(entry => entry.code === scan)
    if (exact) return exact.item
    const included = entries.find(entry => scan.includes(entry.code))
    return included ? included.item : null
  }

  function getCatalogItem(code) {
    return catalogByCode.get(normalizeCode(code)) || null
  }

  function totalForCode(rows, code) {
    const normalized = normalizeCode(code)
    const row = rows.find(item => normalizeCode(item.code) === normalized)
    return row ? row.total : 0
  }

  function downloadPdf(count) {
    if (window.jspdf && window.jspdf.jsPDF) {
      const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
      let y = 14
      const margin = 12

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(16)
      doc.text(`Inventario ${store.name}`, margin, y)
      y += 7
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.text(`Folio: ${count.folio}`, margin, y)
      y += 5
      doc.text(`Inicio: ${formatDateTime(count.startedAt)}   Cierre: ${formatDateTime(count.finalizedAt)}`, margin, y)
      y += 5
      doc.text(`Total piezas: ${formatNumber(count.totalPieces)}   Movimientos: ${formatNumber(count.movements.length)}`, margin, y)
      y += 9

      y = drawPdfTable(doc, 'Conteo por codigo', y, [
        { header: 'Codigo', width: 28, value: row => row.code },
        { header: 'Nombre de la calidad', width: 132, value: row => row.qualityName },
        { header: 'Total pz', width: 25, value: row => formatNumber(row.total), align: 'right' },
      ], count.codeTotals)

      y += 6
      y = drawPdfTable(doc, 'Comparativo por calidad sistema', y, [
        { header: 'Calidad', width: 58, value: row => row.quality },
        { header: 'Conteo', width: 28, value: row => formatNumber(row.counted), align: 'right' },
        { header: 'Sistema', width: 28, value: row => formatNumber(row.expected), align: 'right' },
        { header: 'Faltante', width: 28, value: row => formatNumber(row.shortage), align: 'right' },
        { header: 'Sobrante', width: 28, value: row => formatNumber(row.surplus), align: 'right' },
        { header: 'Dif.', width: 20, value: row => signedNumber(row.difference), align: 'right' },
      ], count.comparisonTotals)

      y += 6
      drawPdfTable(doc, 'Historial de movimientos', y, [
        { header: 'Hora', width: 34, value: row => formatTime(row.createdAt) },
        { header: 'Codigo', width: 30, value: row => row.code },
        { header: 'Scan', width: 62, value: row => row.rawScan },
        { header: 'Piezas', width: 24, value: row => formatNumber(row.quantity), align: 'right' },
        { header: 'Estado', width: 36, value: row => row.updatedAt ? 'Corregido' : 'Original' },
      ], [...count.movements].reverse())

      doc.save(`inventario-${store.slug}-${count.folio}.pdf`)
      return
    }

    openPrintableReport(count)
  }

  function drawPdfTable(doc, title, startY, columns, rows) {
    const margin = 12
    const pageHeight = doc.internal.pageSize.getHeight()
    let y = startY

    function ensureSpace(height) {
      if (y + height <= pageHeight - 12) return
      doc.addPage()
      y = 14
    }

    ensureSpace(18)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.text(title, margin, y)
    y += 5

    doc.setFontSize(8)
    doc.setFillColor(245, 245, 244)
    doc.setDrawColor(214, 211, 209)
    doc.rect(margin, y, columns.reduce((sum, column) => sum + column.width, 0), 7, 'FD')

    let x = margin
    columns.forEach(column => {
      doc.text(column.header, x + 2, y + 4.6)
      x += column.width
    })
    y += 7

    if (!rows.length) {
      doc.setFont('helvetica', 'normal')
      doc.text('Sin datos', margin + 2, y + 5)
      return y + 9
    }

    rows.forEach(row => {
      const cells = columns.map(column => doc.splitTextToSize(String(column.value(row)), column.width - 4))
      const rowHeight = Math.max(7, Math.max(...cells.map(cell => cell.length)) * 4 + 3)
      ensureSpace(rowHeight)
      doc.setDrawColor(231, 229, 228)
      doc.rect(margin, y, columns.reduce((sum, column) => sum + column.width, 0), rowHeight)
      x = margin
      cells.forEach((cell, index) => {
        const column = columns[index]
        doc.setFont('helvetica', index === 0 ? 'bold' : 'normal')
        doc.setFontSize(8)
        doc.text(cell, column.align === 'right' ? x + column.width - 2 : x + 2, y + 4.8, {
          align: column.align || 'left',
          maxWidth: column.width - 4,
        })
        x += column.width
      })
      y += rowHeight
    })

    return y
  }

  function openPrintableReport(count) {
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(`
      <html>
        <head>
          <title>${escapeHtml(count.folio)}</title>
          <style>
            body{font-family:Arial,sans-serif;margin:24px;color:#111}
            h1{font-size:22px;margin:0 0 6px}
            h2{font-size:16px;margin:22px 0 8px}
            p{margin:3px 0;color:#555}
            table{width:100%;border-collapse:collapse;font-size:12px}
            th,td{border:1px solid #ddd;padding:6px;text-align:left}
            th{background:#f5f5f5}
            .right{text-align:right}
          </style>
        </head>
        <body>
          <h1>Inventario ${escapeHtml(store.name)}</h1>
          <p>Folio: ${escapeHtml(count.folio)}</p>
          <p>Inicio: ${formatDateTime(count.startedAt)} - Cierre: ${formatDateTime(count.finalizedAt)}</p>
          <p>Total piezas: ${formatNumber(count.totalPieces)}</p>
          <h2>Conteo por codigo</h2>
          ${renderCodeTable(count.codeTotals)}
          <h2>Comparativo</h2>
          ${renderComparisonTable(count.comparisonTotals)}
        </body>
      </html>
    `)
    win.document.close()
    win.focus()
    win.print()
  }

  function getStoreFromUrl() {
    const params = new URLSearchParams(window.location.search)
    const pathStore = window.location.pathname.replace(/^\/+|\/+$/g, '').split('/').pop() || ''
    const raw = (params.get('tienda') || pathStore || window.location.hash.replace(/^#\/?/, '') || '').trim().toLowerCase()
    if (raw === 'index.html') return null
    const slug = data.aliases[raw] || raw
    return data.stores.find(item => item.slug === slug) || null
  }

  function storeUrl(slug) {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return `./index.html?tienda=${encodeURIComponent(slug)}`
    }
    return `/${encodeURIComponent(slug)}`
  }

  function loadActiveCount(storeSlug) {
    const parsed = readJson(activeKey(storeSlug))
    if (parsed && parsed.storeSlug === storeSlug && Array.isArray(parsed.movements)) return parsed
    return createEmptyCount(storeSlug)
  }

  function loadPastCounts(storeSlug) {
    const parsed = readJson(pastKey(storeSlug))
    return Array.isArray(parsed) ? parsed.filter(item => item.storeSlug === storeSlug) : []
  }

  async function fetchRemoteCounts() {
    if (!supabaseClient || !store) return

    try {
      const { data: rows, error } = await supabaseClient
        .from('inventory_counts')
        .select('local_id, store_slug, folio, started_at, finalized_at, total_pieces, movements, code_totals, comparison_totals')
        .eq('store_slug', store.slug)
        .order('finalized_at', { ascending: false })
        .limit(80)

      if (error || !Array.isArray(rows)) return
      pastCounts = mergePastCounts(pastCounts, rows.map(fromRemoteCount).filter(Boolean))
      savePastCounts()
      updateCounter()
    } catch {
      // Si Supabase no esta configurado o no hay red, la app sigue funcionando local.
    }
  }

  async function syncFinalizedCount(count) {
    if (!supabaseClient) return

    try {
      await supabaseClient.from('inventory_counts').insert(toRemoteCount(count))
    } catch {
      // El cierre queda en este dispositivo aunque falle la sincronizacion remota.
    }
  }

  function toRemoteCount(count) {
    return {
      local_id: count.id,
      store_slug: count.storeSlug,
      folio: count.folio,
      started_at: count.startedAt,
      finalized_at: count.finalizedAt,
      total_pieces: count.totalPieces,
      movements: count.movements,
      code_totals: count.codeTotals,
      comparison_totals: count.comparisonTotals,
    }
  }

  function fromRemoteCount(row) {
    if (!row || !row.local_id || !row.folio) return null

    return {
      id: row.local_id,
      storeSlug: row.store_slug,
      folio: row.folio,
      startedAt: row.started_at,
      finalizedAt: row.finalized_at,
      totalPieces: Number(row.total_pieces) || 0,
      movements: Array.isArray(row.movements) ? row.movements : [],
      codeTotals: Array.isArray(row.code_totals) ? row.code_totals : [],
      comparisonTotals: Array.isArray(row.comparison_totals) ? row.comparison_totals : [],
    }
  }

  function mergePastCounts(current, incoming) {
    const byFolio = new Map()
    current.concat(incoming).forEach(count => {
      if (count && count.folio && !byFolio.has(count.folio)) byFolio.set(count.folio, count)
    })
    return Array.from(byFolio.values())
      .sort((a, b) => new Date(b.finalizedAt).getTime() - new Date(a.finalizedAt).getTime())
      .slice(0, 80)
  }

  function createSupabaseClient() {
    const config = window.INVENTORY_CONFIG || {}
    if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase) return null
    return window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey)
  }

  function createEmptyCount(storeSlug) {
    return {
      id: createId('count'),
      storeSlug,
      startedAt: new Date().toISOString(),
      movements: [],
    }
  }

  function saveActiveCount() {
    localStorage.setItem(activeKey(store.slug), JSON.stringify(activeCount))
  }

  function savePastCounts() {
    localStorage.setItem(pastKey(store.slug), JSON.stringify(pastCounts))
  }

  function readJson(key) {
    try {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }

  function activeKey(storeSlug) {
    return `inventario-scanner:active:${storeSlug}:v1`
  }

  function pastKey(storeSlug) {
    return `inventario-scanner:past:${storeSlug}:v1`
  }

  function parsePieces(value) {
    const number = Number(value)
    if (!Number.isFinite(number) || number <= 0) return null
    return Math.floor(number)
  }

  function normalizeCode(value) {
    return String(value || '')
      .trim()
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Z0-9]/g, '')
  }

  function normalizeSearch(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '')
  }

  function createId(prefix) {
    if (window.crypto && window.crypto.randomUUID) return `${prefix}-${window.crypto.randomUUID()}`
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  }

  function buildFolio(storeSlug) {
    const now = new Date()
    const pad = value => String(value).padStart(2, '0')
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    return `${storeSlug.toUpperCase().replace(/-/g, '')}-${stamp}`
  }

  function setScanError(message) {
    const el = app.querySelector('[data-scan-error]')
    el.hidden = !message
    el.textContent = message
  }

  function setQtyError(message) {
    const el = app.querySelector('[data-qty-error]')
    el.hidden = !message
    el.textContent = message
  }

  function focusScanner() {
    window.setTimeout(() => {
      if (currentTab === 'scan' && !pendingScan && !editingMovement) {
        const input = app.querySelector('[data-scan-input]')
        if (input) input.focus()
      }
    }, 80)
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString('es-MX')
  }

  function signedNumber(value) {
    const number = Number(value || 0)
    return number > 0 ? `+${formatNumber(number)}` : formatNumber(number)
  }

  function formatDateTime(value) {
    return new Intl.DateTimeFormat('es-MX', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value))
  }

  function formatTime(value) {
    return new Intl.DateTimeFormat('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(value))
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }
})()
