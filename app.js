(function () {
  const data = window.INVENTORY_DATA
  const app = document.querySelector('#app')
  const supabaseClient = createSupabaseClient()
  const cloudSyncEnabled = Boolean(supabaseClient)
  const stockStorageKey = 'inventario-scanner:stock-overrides:v4-zero-aware'
  const customCodesStorageKey = 'inventario-scanner:custom-codes:v1'
  const pendingFinalizedStorageKey = 'inventario-scanner:pending-finalized:v1'
  const pendingCustomCodesStorageKey = 'inventario-scanner:pending-custom-codes:v1'
  const historyRenderLimit = 250
  const customCodeBatchSize = 200

  let store = null
  let activeCount = null
  let pastCounts = []
  let stockOverrides = cloudSyncEnabled ? loadStockOverrides() : {}
  let customCodes = loadCustomCodes()
  let pendingFinalizedCounts = loadArray(pendingFinalizedStorageKey)
  let pendingCustomCodes = loadArray(pendingCustomCodesStorageKey)
  let catalogItems = []
  let catalogEntries = []
  let catalogByCode = new Map()
  let dashboardRows = []
  let dashboardClosures = []
  let dashboardTimer = null
  let activeFetchTimer = null
  let activeSyncTimer = null
  let stockFetchTimer = null
  let stockChannel = null
  let stockUploadInProgress = false
  let stockPickerOpen = false
  let fallbackCodeCache = new Map()
  let customCodesFetchTimer = null
  let currentTab = 'scan'
  let pendingScan = null
  let editingMovement = null
  let showAllCodes = false
  let historyQuery = ''
  let lastMovementId = ''
  let readOnlyMode = false
  let lastActiveSyncHash = ''
  let activeSyncInFlight = false
  let backTrapActive = false
  let unknownScanCode = ''
  let addCodeContext = null
  let networkHandlersBound = false
  let cameraStream = null
  let cameraTimer = null
  let cameraDetector = null

  registerOfflineShell()
  purgeLegacyStockCaches()
  refreshCatalogIndex()

  boot()

  function registerOfflineShell() {
    if (!('serviceWorker' in navigator)) return
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // La app sigue funcionando; solo se pierde recarga offline en navegadores sin soporte.
      })
    })
  }

  function boot() {
    bindNetworkSync()
    store = getStoreFromUrl()
    if (!store) {
      renderDashboard()
      return
    }

    readOnlyMode = isReadOnlyUrl()
    if (!readOnlyMode) trapBackButton()
    document.title = `Inventario - ${store.name}`
    activeCount = loadActiveCount(store.slug)
    pastCounts = loadPastCounts(store.slug)
    renderCounter()
    focusScanner()
    subscribeRemoteStocks()
    fetchRemoteCustomCodes()
    fetchRemoteStock()
    fetchRemoteCounts()
    fetchRemoteActiveCount()
    syncPendingData()
    if (!readOnlyMode) syncActiveCountNow(true)
    activeFetchTimer = window.setInterval(fetchRemoteActiveCount, readOnlyMode ? 4500 : 12000)
    stockFetchTimer = window.setInterval(fetchRemoteStock, 5000)
    customCodesFetchTimer = window.setInterval(fetchRemoteCustomCodes, 6000)
  }

  function renderDashboard() {
    if (!isAdminUnlocked()) {
      renderAdminGate()
      return
    }

    const template = document.querySelector('#store-list-template')
    app.replaceChildren(template.content.cloneNode(true))

    app.querySelector('[data-refresh-dashboard]').addEventListener('click', fetchDashboard)
    app.querySelector('[data-add-code]').addEventListener('click', () => openAddCodeSheet('', false))
    app.querySelector('[data-store-grid]').addEventListener('change', event => {
      if (!event.target.matches('[data-stock-upload]')) return
      // El dialogo del sistema ya se resolvio (se eligio un archivo); a partir de aqui
      // uploadStoreStock controla el bloqueo de refresco con stockUploadInProgress.
      stockPickerOpen = false
      const file = event.target.files && event.target.files[0]
      const slug = event.target.dataset.stockUpload
      if (file && slug) uploadStoreStock(slug, file)
      event.target.value = ''
    })
    bindAddCodeSheet()
    subscribeRemoteStocks()

    renderDashboardContent()
    fetchRemoteCustomCodes()
    fetchDashboard()
    syncPendingData()
    dashboardTimer = window.setInterval(fetchDashboard, 5000)
  }

  function renderAdminGate() {
    app.innerHTML = `
      <section class="top-band">
        <div class="top-inner">
          <div>
            <p class="eyebrow">Acceso gerente</p>
            <h1>Dashboard protegido</h1>
            <p class="muted">Las sucursales deben usar su liga directa de conteo.</p>
          </div>
          <div class="brand-mark">INV</div>
        </div>
      </section>
      <section class="page-width admin-gate">
        <form class="panel" data-admin-form>
          <label class="scan-label" for="admin-pin">Clave de gerente</label>
          <input id="admin-pin" class="edit-input compact" data-admin-pin type="password" autocomplete="current-password" />
          <p class="error-text" data-admin-error hidden></p>
          <button class="primary-button full" type="submit">Entrar al dashboard</button>
        </form>
      </section>
    `

    app.querySelector('[data-admin-form]').addEventListener('submit', async event => {
      event.preventDefault()
      const pin = app.querySelector('[data-admin-pin]').value
      if (await verifyAdminPin(pin)) {
        localStorage.setItem('inventario-scanner:admin-unlocked:v1', '1')
        renderDashboard()
        return
      }
      const error = app.querySelector('[data-admin-error]')
      error.hidden = false
      error.textContent = 'Clave incorrecta.'
    })
  }

  function bindNetworkSync() {
    if (networkHandlersBound) return
    networkHandlersBound = true

    window.addEventListener('online', async () => {
      syncPendingData()
      if (store && !readOnlyMode) {
        await fetchRemoteActiveCount()
        syncActiveCountNow(true)
      }
      if (store) {
        fetchRemoteStock()
        fetchRemoteCustomCodes()
        fetchRemoteCounts()
      } else {
        fetchDashboard()
      }
    })
    window.addEventListener('offline', () => {
      if (store) saveActiveCount()
    })
    window.addEventListener('beforeunload', event => {
      if (store && activeCount) saveActiveCount()
      if (store && !readOnlyMode && activeCount && activeCount.movements.length > 0) {
        event.preventDefault()
        event.returnValue = ''
      }
    })
    window.addEventListener('pagehide', () => {
      if (store && activeCount) saveActiveCount()
    })
    window.addEventListener('freeze', () => {
      if (store && activeCount) saveActiveCount()
    })
    document.addEventListener('visibilitychange', () => {
      if (store && activeCount) saveActiveCount()
      if (document.visibilityState !== 'visible') return
      syncPendingData()
      if (store) {
        fetchRemoteStock()
        fetchRemoteCustomCodes()
        fetchRemoteCounts()
      }
      if (store && !readOnlyMode) {
        fetchRemoteActiveCount().finally(() => syncActiveCountNow(true))
      }
    })
  }

  function trapBackButton() {
    // Atrapa el boton de retroceder del navegador o del celular para que
    // no cierre la pagina de conteo. La unica salida intencional es la flecha
    // del encabezado. La captura ya esta guardada en el dispositivo, asi que
    // aunque algo cierre la pagina, el conteo se restaura al volver a abrirla.
    if (backTrapActive) return
    backTrapActive = true
    try {
      window.history.replaceState({ inventarioBase: true, storeSlug: store.slug }, '', window.location.href)
      window.history.pushState({ inventarioTrap: true, storeSlug: store.slug }, '', window.location.href)
    } catch {
      // Algunos navegadores limitan history; el guardado local sigue activo.
    }
    window.addEventListener('popstate', () => {
      if (!store || readOnlyMode) return
      saveActiveCount()
      window.setTimeout(() => {
        try {
          window.history.pushState({ inventarioTrap: true, storeSlug: store.slug }, '', window.location.href)
        } catch {
          // Si no se puede rearmar, beforeunload y el respaldo local protegen el conteo.
        }
        setScanError('Conteo guardado. El boton atras esta bloqueado para evitar salir por error.')
        focusScanner()
      }, 0)
    })
  }

  function renderDashboardContent() {
    const rows = data.stores.map(item => buildStoreDashboardRow(item))
    const totals = rows.reduce((acc, row) => ({
      expected: acc.expected + row.dashboard.expected,
      counted: acc.counted + row.dashboard.counted,
      shortage: acc.shortage + row.dashboard.shortage,
      surplus: acc.surplus + row.dashboard.surplus,
      difference: acc.difference + row.dashboard.difference,
    }), { expected: 0, counted: 0, shortage: 0, surplus: 0, difference: 0 })

    app.querySelector('[data-admin-stock]').textContent = formatNumber(totals.expected)
    app.querySelector('[data-admin-counted]').textContent = formatNumber(totals.counted)
    app.querySelector('[data-admin-shortage]').textContent = formatNumber(totals.shortage)
    app.querySelector('[data-admin-surplus]').textContent = formatNumber(totals.surplus)
    app.querySelector('[data-admin-difference]').textContent = signedNumber(totals.difference)

    app.querySelector('[data-store-grid]').innerHTML = rows.map(row => renderDashboardStoreCard(row)).join('')
    app.querySelector('[data-admin-closures]').innerHTML = renderAdminClosures()
  }

  function buildStoreDashboardRow(item) {
    const live = dashboardRows.find(row => row.store_slug === item.slug)
    const activeCountRow = live && live.active_count && typeof live.active_count === 'object' ? live.active_count : createEmptyCount(item.slug)
    const codeTotals = buildCodeTotals(activeCountRow.movements || [])
    const comparison = buildComparisonTotals(codeTotals, item.slug)
    const dashboard = buildDashboard(comparison)
    const updatedAt = live ? live.updated_at : null
    const age = updatedAt ? Date.now() - new Date(updatedAt).getTime() : Infinity
    const movementCount = live ? Number(live.movement_count) || 0 : 0
    const status = movementCount > 0 ? (age < 90000 ? 'Contando' : 'Pausado') : 'Sin conteo'
    const statusClass = movementCount > 0 ? (age < 90000 ? 'live' : '') : ''
    const lastClosure = dashboardClosures.find(count => count.storeSlug === item.slug)

    return {
      store: item,
      dashboard,
      movementCount,
      updatedAt,
      status,
      statusClass,
      lastClosure,
      stockInfo: getStockInfo(item.slug),
    }
  }

  function renderDashboardStoreCard(row) {
    const item = row.store
    const stockUploadControl = cloudSyncEnabled
      ? `
          <button type="button" data-stock-trigger="${escapeHtml(item.slug)}">Cargar stock</button>
          <input type="file" accept=".xlsx,.xls,.csv,.pdf,application/pdf" data-stock-upload="${escapeHtml(item.slug)}" />
        `
      : '<button type="button" disabled title="Configura Supabase en Netlify para cargar stock compartido.">Cargar stock</button>'

    return `
      <article class="store-card">
        <div>
          <div class="store-footer">
            <strong>${escapeHtml(item.name)}</strong>
            <span class="status-pill ${escapeHtml(row.statusClass)}">${escapeHtml(row.status)}</span>
          </div>
          <p class="muted">${row.updatedAt ? `Actualizado ${formatTime(row.updatedAt)}` : 'Sin avance en nube'}</p>
          <div class="store-status">
            <div class="status-cell"><span>Stock</span><strong>${formatNumber(row.dashboard.expected)}</strong></div>
            <div class="status-cell"><span>Conteo</span><strong>${formatNumber(row.dashboard.counted)}</strong></div>
            <div class="status-cell"><span>Faltante</span><strong>${formatNumber(row.dashboard.shortage)}</strong></div>
            <div class="status-cell"><span>Sobrante</span><strong>${formatNumber(row.dashboard.surplus)}</strong></div>
            <div class="status-cell"><span>Dif. neta</span><strong>${signedNumber(row.dashboard.difference)}</strong></div>
            <div class="status-cell"><span>Movs.</span><strong>${formatNumber(row.movementCount)}</strong></div>
          </div>
          <p class="muted">Stock: ${escapeHtml(row.stockInfo.label)}</p>
          ${row.lastClosure ? `<p class="muted">Ultimo cierre: ${escapeHtml(row.lastClosure.folio)} - ${formatNumber(row.lastClosure.totalPieces)} pz</p>` : ''}
        </div>
        <div class="store-actions">
          <a class="primary-link" href="${escapeHtml(storeUrl(item.slug, true))}">Ver en vivo</a>
          <a href="${escapeHtml(storeUrl(item.slug))}">Abrir conteo</a>
          ${stockUploadControl}
        </div>
      </article>
    `
  }

  function renderAdminClosures() {
    if (!dashboardClosures.length) return empty('Sin cierres en nube')
    return dashboardClosures.slice(0, 20).map(count => {
      const item = data.stores.find(storeItem => storeItem.slug === count.storeSlug)
      return `
        <article class="past-card">
          <div>
            <strong>${escapeHtml(item ? item.name : count.storeSlug)} - <span class="mono">${escapeHtml(count.folio)}</span></strong>
            <p class="muted">${formatDateTime(count.finalizedAt)} - ${formatNumber(count.totalPieces)} pz - ${formatNumber(count.movements.length)} movimientos</p>
          </div>
          <div class="closure-actions">
            <button type="button" class="primary-button" data-admin-pdf="${escapeHtml(count.folio)}">PDF</button>
            <button type="button" class="secondary-button" data-admin-excel="${escapeHtml(count.folio)}">Excel</button>
          </div>
        </article>
      `
    }).join('')
  }

  async function fetchDashboard() {
    if (!app.querySelector('[data-store-grid]')) return
    if (stockUploadInProgress || stockPickerOpen) return
    if (!navigator.onLine) {
      app.querySelector('[data-dashboard-sync]').textContent = 'Sin internet: mostrando ultimo dato guardado en este dispositivo.'
      renderDashboardContent()
      bindDashboardButtons()
      return
    }

    try {
      if (supabaseClient) {
        const [activeResponse, stockResponse, countsResponse] = await Promise.all([
          supabaseClient.from('inventory_active_counts').select('store_slug, local_id, started_at, updated_at, total_pieces, movement_count, active_count, code_totals, comparison_totals, dashboard'),
          supabaseClient.from('inventory_store_stocks').select('store_slug, source_name, source_type, uploaded_at, total_stock, expected_by_quality'),
          supabaseClient.from('inventory_counts').select('local_id, store_slug, folio, started_at, finalized_at, total_pieces, movements, code_totals, comparison_totals').order('finalized_at', { ascending: false }).limit(80),
        ])

        if (Array.isArray(activeResponse.data)) dashboardRows = activeResponse.data
        if (Array.isArray(stockResponse.data)) applyRemoteStocks(stockResponse.data, { force: true })
        if (Array.isArray(countsResponse.data)) dashboardClosures = countsResponse.data.map(fromRemoteCount).filter(Boolean)
        await fetchRemoteCustomCodes()
        app.querySelector('[data-dashboard-sync]').textContent = `Nube actualizada ${formatTime(new Date().toISOString())}`
      } else {
        app.querySelector('[data-dashboard-sync]').textContent = 'Sin Supabase configurado: la carga de stock compartido esta desactivada.'
      }
    } catch {
      app.querySelector('[data-dashboard-sync]').textContent = 'No se pudo leer la nube. Reintentando...'
    }

    renderDashboardContent()
    bindDashboardButtons()
  }

  function bindDashboardButtons() {
    app.querySelectorAll('[data-stock-trigger]').forEach(button => {
      button.addEventListener('click', () => {
        const input = app.querySelector(`[data-stock-upload="${cssEscape(button.dataset.stockTrigger || '')}"]`)
        if (!input) return

        // El refresco automatico del dashboard (fetchDashboard cada 5s) reescribe el
        // innerHTML de la grilla, lo que destruye este <input type="file"> mientras el
        // dialogo del sistema sigue abierto. Si el usuario tarda mas de 5s en elegir el
        // archivo, el evento "change" termina disparando sobre un nodo ya desconectado
        // del DOM y nunca se procesa (por eso "no pasaba nada" y el stock quedaba en 0).
        // Bloqueamos el refresco desde que se abre el selector, no solo despues de elegir
        // el archivo.
        stockPickerOpen = true

        let settled = false
        const releaseGuard = () => {
          if (settled) return
          settled = true
          window.removeEventListener('focus', onWindowFocus)
        }

        const onWindowFocus = () => {
          // Si se eligio un archivo, el evento "change" ya disparo (o esta por disparar)
          // antes de que la ventana recupere el foco y el propio handler de "change" limpia
          // stockPickerOpen. Si no hay archivos, el usuario cancelo el dialogo y hay que
          // liberar el refresco automatico aqui.
          window.setTimeout(() => {
            if (!input.files || !input.files.length) {
              stockPickerOpen = false
            }
            releaseGuard()
          }, 300)
        }

        window.addEventListener('focus', onWindowFocus)
        input.click()
      })
    })

    app.querySelectorAll('[data-admin-pdf]').forEach(button => {
      button.addEventListener('click', () => {
        const count = dashboardClosures.find(item => item.folio === button.dataset.adminPdf)
        const item = count ? data.stores.find(storeItem => storeItem.slug === count.storeSlug) : null
        if (count && item) downloadPdf(count, item)
      })
    })
    app.querySelectorAll('[data-admin-excel]').forEach(button => {
      button.addEventListener('click', () => {
        const count = dashboardClosures.find(item => item.folio === button.dataset.adminExcel)
        const item = count ? data.stores.find(storeItem => storeItem.slug === count.storeSlug) : null
        if (count && item) downloadExcel(count, item)
      })
    })
  }

  function renderCounter() {
    const template = document.querySelector('#counter-template')
    app.replaceChildren(template.content.cloneNode(true))

    app.querySelector('[data-store-name]').textContent = store.name
    app.querySelector('[data-finalize]').style.background = store.color
    const banner = app.querySelector('[data-viewer-banner]')
    if (readOnlyMode) {
      banner.textContent = 'Vista gerente: solo lectura en vivo.'
      banner.hidden = false
    } else if (!cloudSyncEnabled) {
      banner.textContent = 'Sin Supabase configurado: este dispositivo no puede recibir stock cargado en otra computadora.'
      banner.hidden = false
    } else {
      banner.hidden = true
    }
    app.querySelector('[data-scan-panel]').hidden = readOnlyMode
    app.querySelector('[data-reset]').hidden = readOnlyMode
    app.querySelector('[data-finalize]').hidden = readOnlyMode
    bindAddCodeSheet()
    bindCounterEvents()
    updateCounter()
  }

  function bindCounterEvents() {
    if (!readOnlyMode) {
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
      app.querySelector('[data-add-unknown]').addEventListener('click', () => openAddCodeSheet(unknownScanCode, true))
      app.querySelector('[data-camera-scan]').addEventListener('click', startCameraScan)
      bindQuantitySheet()
      bindEditSheet()
      bindCameraSheet()
    }

    if (readOnlyMode) {
      const tablesButton = app.querySelector('[data-tab-button="tables"]')
      if (tablesButton) {
        currentTab = 'tables'
      }
    }

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

    if (readOnlyMode) setTab(currentTab)
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

  function bindCameraSheet() {
    const close = app.querySelector('[data-close-camera]')
    if (!close || close.dataset.bound === '1') return
    close.dataset.bound = '1'
    close.addEventListener('click', stopCameraScan)
  }

  function bindAddCodeSheet() {
    const form = app.querySelector('[data-code-form]')
    const close = app.querySelector('[data-close-code]')
    if (!form || form.dataset.bound === '1') return

    form.dataset.bound = '1'
    form.addEventListener('submit', event => {
      event.preventDefault()
      saveCustomCode()
    })
    if (close) close.addEventListener('click', closeAddCodeSheet)
  }

  function openAddCodeSheet(code, continueToQuantity) {
    const sheet = app.querySelector('[data-code-sheet]')
    if (!sheet) return

    addCodeContext = {
      rawScan: code || '',
      continueToQuantity: Boolean(continueToQuantity && store && !readOnlyMode),
    }
    app.querySelector('[data-code-input]').value = normalizeCode(code || '')
    app.querySelector('[data-product-input]').value = ''
    setCodeError('')
    sheet.hidden = false
    window.setTimeout(() => {
      const input = app.querySelector(code ? '[data-product-input]' : '[data-code-input]')
      if (input) input.focus()
    }, 60)
  }

  function closeAddCodeSheet() {
    addCodeContext = null
    const sheet = app.querySelector('[data-code-sheet]')
    if (sheet) sheet.hidden = true
    focusScanner()
  }

  async function saveCustomCode() {
    const code = normalizeCode(app.querySelector('[data-code-input]').value)
    const productName = String(app.querySelector('[data-product-input]').value || '').trim().toUpperCase()

    if (!code) {
      setCodeError('Captura el codigo.')
      return
    }
    if (!productName) {
      setCodeError('Captura el nombre del producto.')
      return
    }

    await fetchRemoteCustomCodes()
    const existing = getCatalogItem(code)
    if (existing) {
      if (addCodeContext && addCodeContext.continueToQuantity) {
        const rawScan = addCodeContext.rawScan || code
        closeAddCodeSheet()
        unknownScanCode = ''
        setScanError('')
        pendingScan = { item: existing, rawScan }
        openQuantitySheet()
        return
      }
      setCodeError('Ese codigo ya existe en la nube. Ya pueden escanearlo todas las sucursales.')
      return
    }

    const item = {
      code,
      qualityName: productName,
      systemQuality: productName,
      productName,
      custom: true,
      createdAt: new Date().toISOString(),
      createdByStore: store ? store.slug : 'gerente',
    }

    addCustomCode(item)
    await syncCustomCode(item)
    const shouldOpenQuantity = addCodeContext && addCodeContext.continueToQuantity
    const rawScan = addCodeContext && addCodeContext.rawScan ? addCodeContext.rawScan : code
    closeAddCodeSheet()

    if (shouldOpenQuantity) {
      unknownScanCode = ''
      setScanError('')
      pendingScan = { item, rawScan }
      openQuantitySheet()
      return
    }

    if (app.querySelector('[data-dashboard-sync]')) {
      app.querySelector('[data-dashboard-sync]').textContent = `Codigo ${code} agregado.`
      renderDashboardContent()
      bindDashboardButtons()
    }
  }

  function updateCounter() {
    const codeTotals = buildCodeTotals(activeCount.movements)
    const comparison = buildComparisonTotals(codeTotals, store.slug)
    const dashboard = buildDashboard(comparison)
    const countedCodes = codeTotals.filter(row => row.total > 0).length
    const lastMovement = activeCount.movements.find(row => row.id === lastMovementId)

    app.querySelector('[data-count-meta]').textContent = `${readOnlyMode ? 'Vista gerente' : 'Inicio'} ${formatDateTime(activeCount.startedAt)} - ${activeCount.movements.length} movimientos${syncStatusText()}`
    app.querySelector('[data-reset]').disabled = readOnlyMode || activeCount.movements.length === 0
    app.querySelector('[data-finalize]').disabled = readOnlyMode || activeCount.movements.length === 0
    app.querySelector('[data-metric-expected]').textContent = formatNumber(dashboard.expected)
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
    app.querySelector('[data-recent-movements]').innerHTML = renderMovementList(activeCount.movements.slice(0, 6), readOnlyMode)
    app.querySelector('[data-history-list]').innerHTML = renderMovementList(filterMovements(activeCount.movements), readOnlyMode, historyRenderLimit)
    app.querySelector('[data-past-list]').innerHTML = renderPastCounts()

    bindDynamicButtons()
    if (!readOnlyMode) {
      saveActiveCount()
      scheduleActiveSync()
    }
    savePastCounts()
  }

  function bindDynamicButtons() {
    if (!readOnlyMode) {
      app.querySelectorAll('[data-edit-movement]').forEach(button => {
        button.addEventListener('click', () => openEditSheet(button.dataset.editMovement))
      })
      app.querySelectorAll('[data-delete-movement]').forEach(button => {
        button.addEventListener('click', () => deleteMovement(button.dataset.deleteMovement))
      })
    }
    app.querySelectorAll('[data-pdf-count]').forEach(button => {
      button.addEventListener('click', () => {
        const count = pastCounts.find(item => item.id === button.dataset.pdfCount)
        if (count) downloadPdf(count)
      })
    })
    app.querySelectorAll('[data-excel-count]').forEach(button => {
      button.addEventListener('click', () => {
        const count = pastCounts.find(item => item.id === button.dataset.excelCount)
        if (count) downloadExcel(count)
      })
    })
  }

  async function processScan() {
    if (readOnlyMode) return
    const input = app.querySelector('[data-scan-input]')
    const rawScan = input.value.trim()
    if (!rawScan) return

    let item = findItemByScan(rawScan)
    input.value = ''
    setScanError('')

    if (!item) {
      await fetchRemoteCustomCodes()
      item = findItemByScan(rawScan)
    }

    if (!item) {
      lastMovementId = ''
      unknownScanCode = rawScan
      setScanError(`Codigo no registrado: ${rawScan}`)
      const addButton = app.querySelector('[data-add-unknown]')
      if (addButton) addButton.hidden = false
      updateCounter()
      focusScanner()
      return
    }

    unknownScanCode = ''
    const addButton = app.querySelector('[data-add-unknown]')
    if (addButton) addButton.hidden = true
    pendingScan = { item, rawScan }
    openQuantitySheet()
  }

  async function startCameraScan() {
    if (readOnlyMode) return
    const sheet = app.querySelector('[data-camera-sheet]')
    const video = app.querySelector('[data-camera-video]')
    const error = app.querySelector('[data-camera-error]')
    if (!sheet || !video || !error) return

    if (!('BarcodeDetector' in window)) {
      error.hidden = false
      error.textContent = 'Este navegador no soporta escaneo con camara. Usa Chrome actualizado o un scanner fisico.'
      sheet.hidden = false
      return
    }

    try {
      error.hidden = true
      sheet.hidden = false
      cameraDetector = new window.BarcodeDetector({
        formats: ['code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'codabar', 'qr_code'],
      })
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      video.srcObject = cameraStream
      await video.play()
      cameraTimer = window.setInterval(detectCameraCode, 450)
    } catch {
      error.hidden = false
      error.textContent = 'No pude abrir la camara. Revisa permisos del navegador.'
      stopCameraStreamOnly()
    }
  }

  async function detectCameraCode() {
    const video = app.querySelector('[data-camera-video]')
    if (!video || !cameraDetector || video.readyState < 2) return

    try {
      const codes = await cameraDetector.detect(video)
      const rawValue = codes && codes[0] && codes[0].rawValue
      if (!rawValue) return
      stopCameraScan()
      const input = app.querySelector('[data-scan-input]')
      if (input) input.value = rawValue
      await processScan()
    } catch {
      // Mantiene la camara activa; algunos frames pueden fallar.
    }
  }

  function stopCameraScan() {
    const sheet = app.querySelector('[data-camera-sheet]')
    if (sheet) sheet.hidden = true
    stopCameraStreamOnly()
    focusScanner()
  }

  function stopCameraStreamOnly() {
    window.clearInterval(cameraTimer)
    cameraTimer = null
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop())
      cameraStream = null
    }
    cameraDetector = null
    const video = app.querySelector('[data-camera-video]')
    if (video) video.srcObject = null
  }

  function openQuantitySheet() {
    const codeTotals = buildCodeTotals(activeCount.movements)
    const sheet = app.querySelector('[data-quantity-sheet]')
    const input = app.querySelector('[data-qty-input]')

    app.querySelector('[data-sheet-code]').textContent = pendingScan.item.code
    app.querySelector('[data-sheet-quality]').textContent = productLabelForItem(pendingScan.item)
    app.querySelector('[data-sheet-system]').textContent = pendingScan.item.variantName ? `Variante: ${pendingScan.item.variantName}` : 'Producto individual'
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
    if (readOnlyMode) return
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
    saveActiveCount()
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
    app.querySelector('[data-edit-quality]').textContent = item ? productLabelForItem(item) : 'Codigo'
    app.querySelector('[data-edit-input]').value = String(movement.quantity)
    setEditError('')
    app.querySelector('[data-edit-sheet]').hidden = false
    window.setTimeout(() => app.querySelector('[data-edit-input]').select(), 60)
  }

  function closeEditSheet() {
    editingMovement = null
    setEditError('')
    app.querySelector('[data-edit-sheet]').hidden = true
    focusScanner()
  }

  function saveMovementEdit() {
    if (readOnlyMode) return
    if (!editingMovement) return

    const rawValue = app.querySelector('[data-edit-input]').value
    const number = Number(rawValue)
    // A diferencia de un escaneo nuevo, una correccion si puede dejar el movimiento
    // en 0 piezas (por ejemplo si el escaneo original fue un error). Antes, cualquier
    // valor invalido o en 0 hacia que "Guardar correccion" no hiciera nada y sin
    // ningun aviso, lo que parecia que el boton estaba roto.
    if (rawValue.trim() === '' || !Number.isFinite(number) || number < 0) {
      setEditError('Escribe un numero valido (puede ser 0).')
      return
    }
    const quantity = Math.floor(number)

    activeCount.movements = activeCount.movements.map(item => {
      if (item.id !== editingMovement.id) return item
      return { ...item, quantity, updatedAt: new Date().toISOString() }
    })
    closeEditSheet()
    updateCounter()
  }

  function deleteMovement(id) {
    if (readOnlyMode) return
    const movement = activeCount.movements.find(item => item.id === id)
    if (!movement) return

    const item = getCatalogItem(movement.code)
    const label = item ? `${item.code} - ${productLabelForItem(item)}` : movement.code
    if (!window.confirm(`Eliminar movimiento?\n${label}\n${movement.quantity} pz`)) return

    activeCount.movements = activeCount.movements.filter(item => item.id !== id)
    // Se recuerda el id borrado (aunque la nube todavia tenga la version vieja)
    // para que ninguna sincronizacion o refresco posterior lo vuelva a agregar.
    if (!Array.isArray(activeCount.deletedMovementIds)) activeCount.deletedMovementIds = []
    if (!activeCount.deletedMovementIds.includes(id)) activeCount.deletedMovementIds.push(id)
    if (lastMovementId === id) lastMovementId = ''
    updateCounter()
  }

  function resetActiveCount() {
    if (readOnlyMode) return
    if (!activeCount.movements.length) return
    if (!window.confirm('Borrar conteo actual y empezar de cero?')) return

    activeCount = createEmptyCount(store.slug)
    lastMovementId = ''
    lastActiveSyncHash = ''
    saveActiveCount()
    setTab('scan')
    updateCounter()
    syncActiveCountNow(true, { skipRemoteMerge: true })
    focusScanner()
  }

  function finalizeCount() {
    if (readOnlyMode) return
    if (!activeCount.movements.length) return
    if (!window.confirm('Finalizar conteo? Despues del cierre ya no se podra modificar.')) return

    const codeTotals = buildCodeTotals(activeCount.movements)
    const comparison = buildComparisonTotals(codeTotals, store.slug)
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
    downloadExcel(finalized)

    // Al cerrar el conteo, el stock del sistema vuelve a 0 para esta sucursal: el
    // siguiente periodo empieza limpio hasta que se cargue un archivo de stock nuevo.
    resetStoreStockAfterClosure(store.slug)

    activeCount = createEmptyCount(store.slug)
    lastMovementId = ''
    lastActiveSyncHash = ''
    saveActiveCount()
    setTab('past')
    updateCounter()
    syncActiveCountNow(true, { skipRemoteMerge: true })
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
              <th>Producto</th>
              <th class="right">Total de pz</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => `
              <tr>
                <td class="mono">${escapeHtml(row.code)}</td>
                <td>${escapeHtml(row.productLabel)}</td>
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
              <th>Producto</th>
              <th class="right">Conteo</th>
              <th class="right">Sistema</th>
              ${compact ? '' : '<th class="right">Faltante</th><th class="right">Sobrante</th>'}
              <th class="right">Dif.</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => `
              <tr>
                <td>
                  <strong class="mono">${escapeHtml(row.code)}</strong>
                  <span>${escapeHtml(row.product)}</span>
                </td>
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

  function renderMovementList(rows, readOnly, limit) {
    if (!rows.length) return empty('Sin movimientos')

    const visibleRows = limit ? rows.slice(0, limit) : rows
    const hiddenCount = rows.length - visibleRows.length
    const html = visibleRows.map(movement => {
      const item = getCatalogItem(movement.code)
      return `
        <article class="movement">
          <div class="movement-main">
            <div class="movement-title">
              <strong class="mono">${escapeHtml(movement.code)}</strong>
              <span class="pill">${formatNumber(movement.quantity)} pz</span>
              ${movement.updatedAt ? '<span class="pill">corregido</span>' : ''}
            </div>
            <p>${escapeHtml(item ? productLabelForItem(item) : 'Codigo no encontrado')}</p>
            <p>${formatTime(movement.createdAt)} - scan: ${escapeHtml(movement.rawScan)}</p>
          </div>
          ${readOnly ? '' : `
            <div class="movement-actions">
              <button type="button" data-edit-movement="${escapeHtml(movement.id)}" aria-label="Corregir">E</button>
              <button type="button" class="danger" data-delete-movement="${escapeHtml(movement.id)}" aria-label="Eliminar">X</button>
            </div>
          `}
        </article>
      `
    }).join('')
    return hiddenCount > 0
      ? `${html}<div class="empty compact">Mostrando ${formatNumber(visibleRows.length)} de ${formatNumber(rows.length)} movimientos. Usa buscar para filtrar.</div>`
      : html
  }

  function renderPastCounts() {
    if (!pastCounts.length) return empty('Sin cierres guardados')
    return pastCounts.map(count => `
      <article class="past-card">
        <div>
          <strong class="mono">${escapeHtml(count.folio)}</strong>
          <p class="muted">${formatDateTime(count.finalizedAt)} - ${formatNumber(count.totalPieces)} pz - ${count.movements.length} movimientos</p>
        </div>
        <div class="closure-actions">
          <button type="button" class="primary-button" data-pdf-count="${escapeHtml(count.id)}">PDF</button>
          <button type="button" class="secondary-button" data-excel-count="${escapeHtml(count.id)}">Excel</button>
        </div>
      </article>
    `).join('')
  }

  function empty(text) {
    return `<div class="empty">${escapeHtml(text)}</div>`
  }

  function buildCodeTotals(movements) {
    const totals = new Map()
    movements.forEach(movement => {
      const item = getCatalogItem(movement.code)
      const key = normalizeCode(item ? item.code : movement.code)
      totals.set(key, (totals.get(key) || 0) + movement.quantity)
    })

    return catalogItems.map(item => ({
      code: item.code,
      qualityName: item.qualityName,
      systemQuality: item.systemQuality,
      productLabel: productLabelForItem(item),
      total: totals.get(normalizeCode(item.code)) || 0,
    })).sort((a, b) => a.code.localeCompare(b.code, 'es-MX', { numeric: true }))
  }

  function buildComparisonTotals(codeTotals, storeSlug) {
    const expectedByProduct = getExpectedByProductForStore(storeSlug)
    const productCodes = new Set([
      ...Object.keys(expectedByProduct),
      ...catalogItems.map(item => normalizeCode(item.code)),
    ])
    const counted = new Map()
    codeTotals.forEach(row => {
      const code = normalizeCode(row.code)
      counted.set(code, (counted.get(code) || 0) + row.total)
    })

    return Array.from(productCodes).sort((a, b) => {
      const itemA = getCatalogItem(a)
      const itemB = getCatalogItem(b)
      const labelA = itemA ? productLabelForItem(itemA) : a
      const labelB = itemB ? productLabelForItem(itemB) : b
      return labelA.localeCompare(labelB, 'es-MX', { numeric: true })
    }).map(code => {
      const item = getCatalogItem(code)
      const product = item ? productLabelForItem(item) : code
      const countedPieces = counted.get(code) || 0
      const expected = Number(expectedByProduct[code]) || 0
      const difference = countedPieces - expected
      return {
        code: item ? item.code : code,
        product,
        quality: product,
        counted: countedPieces,
        expected,
        difference,
        shortage: Math.max(0, expected - countedPieces),
        surplus: Math.max(0, countedPieces - expected),
      }
    })
  }

  function buildDashboard(rows) {
    const totals = rows.reduce((acc, row) => ({
      counted: acc.counted + row.counted,
      expected: acc.expected + row.expected,
    }), { counted: 0, expected: 0 })
    const difference = totals.counted - totals.expected
    return {
      counted: totals.counted,
      expected: totals.expected,
      shortage: Math.max(0, totals.expected - totals.counted),
      surplus: Math.max(0, totals.counted - totals.expected),
      difference,
    }
  }

  function getExpectedByProductForStore(storeSlug) {
    const override = stockOverrides[storeSlug]
    if (override && override.expectedByProduct && typeof override.expectedByProduct === 'object') {
      return normalizeProductStockObject(override.expectedByProduct)
    }
    if (override && override.expectedByQuality && typeof override.expectedByQuality === 'object') {
      return normalizeProductStockObject(override.expectedByQuality)
    }

    return {}
  }

  function getStockInfo(storeSlug) {
    const override = stockOverrides[storeSlug]
    if (override && override.uploadedAt) {
      return {
        label: `${override.sourceName || 'archivo cargado'} (${formatDateTime(override.uploadedAt)})`,
        total: totalStockForStore(storeSlug),
      }
    }
    return { label: 'base del proyecto', total: totalStockForStore(storeSlug) }
  }

  function totalStockForStore(storeSlug) {
    return Object.values(getExpectedByProductForStore(storeSlug)).reduce((sum, value) => sum + (Number(value) || 0), 0)
  }

  function filterMovements(rows) {
    const query = normalizeSearch(historyQuery)
    if (!query) return rows
    return rows.filter(movement => {
      const item = getCatalogItem(movement.code)
      return normalizeSearch(`${movement.code} ${movement.rawScan} ${item ? productLabelForItem(item) : ''} ${item ? item.variantName || '' : ''}`).includes(query)
    })
  }

  function findItemByScan(rawScan) {
    const scan = normalizeCode(rawScan)
    if (!scan) return null

    const exact = catalogEntries.find(entry => entry.code === scan)
    if (exact) return exact.item
    const included = catalogEntries.find(entry => scan.includes(entry.code))
    return included ? included.item : null
  }

  function getCatalogItem(code) {
    return catalogByCode.get(normalizeCode(code)) || null
  }

  function productLabelForItem(item) {
    if (!item) return ''
    return String(item.qualityName || item.productName || item.systemQuality || item.code || '').trim().toUpperCase()
  }

  function totalForCode(rows, code) {
    const normalized = normalizeCode(code)
    const row = rows.find(item => normalizeCode(item.code) === normalized)
    return row ? row.total : 0
  }

  function buildCatalogEntries(catalog, aliases) {
    const byCode = new Map(catalog.map(item => [normalizeCode(item.code), item]))
    const entries = catalog.map(item => ({ item, code: normalizeCode(item.code) }))

    Object.entries(aliases || {}).forEach(([alias, targetCode]) => {
      const item = byCode.get(normalizeCode(targetCode))
      const code = normalizeCode(alias)
      if (item && code) entries.push({ item, code })
    })

    return entries
      .filter(entry => entry.code)
      .sort((a, b) => b.code.length - a.code.length)
  }

  function downloadPdf(count, reportStore = store) {
    if (window.jspdf && window.jspdf.jsPDF) {
      const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
      let y = 14
      const margin = 12

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(16)
      doc.text(`Inventario ${reportStore.name}`, margin, y)
      y += 7
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.text(`Folio: ${count.folio}`, margin, y)
      y += 5
      doc.text(`Inicio: ${formatDateTime(count.startedAt)}   Cierre: ${formatDateTime(count.finalizedAt)}`, margin, y)
      y += 5
      doc.text(`Total piezas: ${formatNumber(count.totalPieces)}   Movimientos: ${formatNumber(count.movements.length)}`, margin, y)
      y += 9

      y = drawPdfTable(doc, 'Comparativo sistema vs conteo fisico', y, [
        { header: 'Codigo', width: 24, value: row => row.code },
        { header: 'Producto', width: 62, value: row => row.product || row.quality },
        { header: 'Conteo', width: 24, value: row => formatNumber(row.counted), align: 'right' },
        { header: 'Sistema', width: 24, value: row => formatNumber(row.expected), align: 'right' },
        { header: 'Faltante', width: 22, value: row => formatNumber(row.shortage), align: 'right' },
        { header: 'Sobrante', width: 22, value: row => formatNumber(row.surplus), align: 'right' },
        { header: 'Dif.', width: 14, value: row => signedNumber(row.difference), align: 'right' },
      ], count.comparisonTotals)

      doc.save(`inventario-${reportStore.slug}-${count.folio}.pdf`)
      return
    }

    openPrintableReport(count, reportStore)
  }

  function excelLocationForStore(reportStore) {
    const locations = {
      'almacen-general': 'A.G./Stock',
    }
    return locations[reportStore.slug] || `${reportStore.name}/Stock`
  }

  function excelProductName(item, row) {
    if (!item) return String(row.productLabel || row.qualityName || row.code || '').trim().toUpperCase()
    const name = String(item.productName || item.qualityName || item.code || '').trim().toUpperCase()
    const values = String(item.variantName || '')
      .split(' - ')
      .map(part => {
        const separator = part.lastIndexOf(': ')
        return (separator >= 0 ? part.slice(separator + 2) : part).trim()
      })
      .filter(Boolean)
    return values.length ? `${name} (${values.join(', ')})` : name
  }

  function downloadExcel(count, reportStore = store) {
    if (!window.XLSX) {
      window.alert('No se pudo generar el Excel: la libreria XLSX no cargo. Revisa tu conexion y vuelve a intentar desde Cierres.')
      return
    }

    const location = excelLocationForStore(reportStore)
    const rows = (count.codeTotals || [])
      .filter(row => row.total > 0)
      .map(row => {
        const item = getCatalogItem(row.code)
        return [
          location,
          excelProductName(item, row),
          '',
          row.total,
          'Pieza',
          0,
          0,
        ]
      })

    const headers = ['Ubicación', 'Producto', 'Lote/Nº de serie', 'Cantidad', 'Unidad de medida', 'Cantidade contada', 'Diferencia']
    const sheet = window.XLSX.utils.aoa_to_sheet([headers, ...rows])

    // Formato numerico 0.00 en Cantidad, Cantidade contada y Diferencia
    for (let rowIndex = 1; rowIndex <= rows.length; rowIndex += 1) {
      ;['D', 'F', 'G'].forEach(column => {
        const cell = sheet[`${column}${rowIndex + 1}`]
        if (cell && typeof cell.v === 'number') cell.z = '0.00'
      })
    }

    sheet['!cols'] = [
      { wch: 14 },
      { wch: 52 },
      { wch: 16 },
      { wch: 10 },
      { wch: 16 },
      { wch: 16 },
      { wch: 10 },
    ]

    const workbook = window.XLSX.utils.book_new()
    window.XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1')
    window.XLSX.writeFile(workbook, `inventario-${reportStore.slug}-${count.folio}.xlsx`)
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

  function openPrintableReport(count, reportStore = store) {
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
          <h1>Inventario ${escapeHtml(reportStore.name)}</h1>
          <p>Folio: ${escapeHtml(count.folio)}</p>
          <p>Inicio: ${formatDateTime(count.startedAt)} - Cierre: ${formatDateTime(count.finalizedAt)}</p>
          <p>Total piezas: ${formatNumber(count.totalPieces)}</p>
          <h2>Comparativo sistema vs conteo fisico</h2>
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

  function isReadOnlyUrl() {
    const params = new URLSearchParams(window.location.search)
    const raw = `${params.get('visor') || ''}${params.get('modo') || ''}${params.get('view') || ''}`.toLowerCase()
    return raw.includes('1') || raw.includes('visor') || raw.includes('gerente') || raw.includes('admin')
  }

  function storeUrl(slug, viewer) {
    const suffix = viewer ? '?visor=1' : ''
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return `./index.html?tienda=${encodeURIComponent(slug)}${viewer ? '&visor=1' : ''}`
    }
    return `/${encodeURIComponent(slug)}${suffix}`
  }

  function loadActiveCount(storeSlug) {
    const candidates = [readJson(activeKey(storeSlug)), readJson(activeBackupKey(storeSlug))]
      .map(item => item && item.count ? item.count : item)
      .filter(item => item && item.storeSlug === storeSlug && Array.isArray(item.movements))
    if (candidates.length) {
      return candidates.sort((a, b) => {
        const movementDiff = (b.movements.length || 0) - (a.movements.length || 0)
        if (movementDiff) return movementDiff
        return lastCountActivity(b) - lastCountActivity(a)
      })[0]
    }
    return createEmptyCount(storeSlug)
  }

  function lastCountActivity(count) {
    const movementTimes = (count.movements || []).map(item => new Date(item.updatedAt || item.createdAt || 0).getTime() || 0)
    return Math.max(new Date(count.startedAt || 0).getTime() || 0, ...movementTimes)
  }

  function loadPastCounts(storeSlug) {
    const parsed = readJson(pastKey(storeSlug))
    return Array.isArray(parsed) ? parsed.filter(item => item.storeSlug === storeSlug) : []
  }

  function loadStockOverrides() {
    const parsed = readJson(stockStorageKey)
    return parsed && typeof parsed === 'object' ? parsed : {}
  }

  function purgeLegacyStockCaches() {
    try {
      Object.keys(localStorage)
        .filter(key => key.startsWith('inventario-scanner:stock-overrides:') && key !== stockStorageKey)
        .forEach(key => localStorage.removeItem(key))
    } catch {
      // Si el navegador bloquea localStorage, la nube sigue siendo la fuente real.
    }
  }

  function loadCustomCodes() {
    return loadArray(customCodesStorageKey)
  }

  function loadArray(key) {
    const parsed = readJson(key)
    return Array.isArray(parsed) ? parsed : []
  }

  function saveStockOverrides() {
    if (!cloudSyncEnabled) return
    writeLocalJson(stockStorageKey, stockOverrides)
  }

  function saveCustomCodes() {
    writeLocalJson(customCodesStorageKey, customCodes)
  }

  function savePendingFinalizedCounts() {
    writeLocalJson(pendingFinalizedStorageKey, pendingFinalizedCounts)
  }

  function savePendingCustomCodes() {
    writeLocalJson(pendingCustomCodesStorageKey, pendingCustomCodes)
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

  function subscribeRemoteStocks() {
    if (!supabaseClient || stockChannel || typeof supabaseClient.channel !== 'function') return

    stockChannel = supabaseClient
      .channel('inventory-store-stocks-v1')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'inventory_store_stocks',
      }, payload => {
        if (!payload || !payload.new) return
        const changed = applyRemoteStocks([payload.new], { force: true })
        if (!changed) return
        if (store && app.querySelector('[data-count-meta]')) {
          updateCounter()
          return
        }
        if (!store && app.querySelector('[data-store-grid]')) {
          renderDashboardContent()
          bindDashboardButtons()
        }
      })
      .subscribe()
  }

  async function fetchRemoteStock() {
    if (!supabaseClient) return

    try {
      const { data: rows, error } = await supabaseClient
        .from('inventory_store_stocks')
        .select('store_slug, source_name, source_type, uploaded_at, total_stock, expected_by_quality')

      if (error) throw error
      if (Array.isArray(rows)) {
        // Supabase es la fuente autoritativa: siempre reemplaza cualquier copia
        // local anterior, incluso si el reloj de otro telefono estaba adelantado.
        const changed = applyRemoteStocks(rows, { force: true })
        if (changed && store) updateCounter()
      }
    } catch {
      // Si la tabla aun no existe, usa el stock base de data.js.
    }
  }

  async function fetchRemoteCustomCodes() {
    if (!supabaseClient) return

    try {
      const { data: rows } = await supabaseClient
        .from('inventory_custom_codes')
        .select('code, quality_name, system_quality, product_name, created_at, created_by_store, source')
        .order('created_at', { ascending: false })

      if (Array.isArray(rows)) {
        applyRemoteCustomCodes(rows)
        if (store && app.querySelector('[data-code-table]')) updateCounter()
      }
    } catch {
      // Si la tabla aun no existe, se usan codigos personalizados locales.
    }
  }

  async function syncCustomCode(item) {
    return syncCustomCodes([item])
  }

  async function syncCustomCodes(items) {
    const cleanItems = uniqueCustomCodeItems(items)
    if (!cleanItems.length) return true

    if (!supabaseClient || !navigator.onLine) {
      cleanItems.forEach(item => queueCustomCode(item))
      return false
    }

    let allSynced = true
    try {
      const chunks = chunkArray(cleanItems, customCodeBatchSize)
      for (const chunk of chunks) {
        const payload = chunk.map(item => ({
          code: item.code,
          quality_name: item.qualityName,
          system_quality: item.systemQuality,
          product_name: item.productName,
          created_at: item.createdAt || new Date().toISOString(),
          created_by_store: item.createdByStore || (store ? store.slug : 'gerente'),
          source: item.source || 'manual',
        }))
        const error = await saveCustomCodeChunk(payload)
        if (error) {
          allSynced = false
          chunk.forEach(item => queueCustomCode(item))
          continue
        }
        chunk.forEach(item => removePendingCustomCode(item.code))
      }
      return allSynced
    } catch {
      // El codigo queda disponible en este dispositivo aunque falle la nube.
      cleanItems.forEach(item => queueCustomCode(item))
      return false
    }
  }

  async function saveCustomCodeChunk(payload) {
    const rpcResponse = await supabaseClient.rpc('save_inventory_custom_codes', { p_items: payload })
    if (!rpcResponse.error) return null
    if (!isMissingRpcError(rpcResponse.error)) return rpcResponse.error

    const { error } = await supabaseClient
      .from('inventory_custom_codes')
      .upsert(payload, { onConflict: 'code', ignoreDuplicates: true })
    return error || null
  }

  async function fetchRemoteActiveCount() {
    if (!supabaseClient || !store) return

    try {
      const remote = await loadRemoteActiveCount()
      if (!remote) return
      mergeRemoteActiveCount(remote)
      updateCounter()
    } catch {
      // Sigue funcionando local si la nube no responde.
    }
  }

  function scheduleActiveSync() {
    if (!supabaseClient || !store || readOnlyMode) return
    window.clearTimeout(activeSyncTimer)
    activeSyncTimer = window.setTimeout(() => syncActiveCountNow(false), 600)
  }

  async function syncActiveCountNow(force, options = {}) {
    if (!supabaseClient || !store || readOnlyMode) return
    if (!navigator.onLine) {
      saveActiveCount()
      return
    }
    if (activeSyncInFlight) {
      if (force) {
        window.clearTimeout(activeSyncTimer)
        activeSyncTimer = window.setTimeout(() => syncActiveCountNow(true, options), 900)
      }
      return
    }

    activeSyncInFlight = true
    const syncCountId = activeCount.id
    try {
      if (!options.skipRemoteMerge) {
        const remote = await loadRemoteActiveCount()
        if (remote) mergeRemoteActiveCount(remote)
      }

      // Si el conteo cambio mientras esperabamos la nube (por ejemplo al finalizar),
      // no debemos volver a subir el conteo anterior encima del nuevo.
      if (activeCount.id !== syncCountId) return

      const codeTotals = buildCodeTotals(activeCount.movements)
      const comparison = buildComparisonTotals(codeTotals, store.slug)
      const dashboard = buildDashboard(comparison)
      const payload = {
        store_slug: store.slug,
        local_id: activeCount.id,
        started_at: activeCount.startedAt,
        updated_at: new Date().toISOString(),
        total_pieces: dashboard.counted,
        movement_count: activeCount.movements.length,
        active_count: activeCount,
        code_totals: codeTotals.filter(row => row.total > 0),
        comparison_totals: comparison.filter(row => row.counted || row.expected),
        dashboard,
      }
      const hash = JSON.stringify(payload)
      if (!force && hash === lastActiveSyncHash) return

      const { error } = await supabaseClient.from('inventory_active_counts').upsert(payload, { onConflict: 'store_slug' })
      if (error) throw error
      lastActiveSyncHash = hash
    } catch {
      // La captura local se mantiene aunque falle la sincronizacion en vivo.
    } finally {
      activeSyncInFlight = false
    }
  }

  async function syncFinalizedCount(count) {
    if (!supabaseClient || !navigator.onLine) {
      queueFinalizedCount(count)
      return false
    }

    try {
      const { error } = await supabaseClient.from('inventory_counts').insert(toRemoteCount(count))
      if (error && error.code === '23505') {
        removePendingFinalizedCount(count.folio)
        return true
      }
      if (error) {
        queueFinalizedCount(count)
        return false
      }
      removePendingFinalizedCount(count.folio)
      return true
    } catch {
      // El cierre queda en este dispositivo aunque falle la sincronizacion remota.
      queueFinalizedCount(count)
      return false
    }
  }

  async function syncPendingData() {
    if (!supabaseClient || !navigator.onLine) return

    const pendingCodes = [...pendingCustomCodes]
    await syncCustomCodes(pendingCodes)

    const pendingCounts = [...pendingFinalizedCounts]
    for (const count of pendingCounts) {
      await syncFinalizedCount(count)
    }

    if (store && app.querySelector('[data-count-meta]')) updateCounter()
    if (!store && app.querySelector('[data-store-grid]')) renderDashboardContent()
  }

  function queueFinalizedCount(count) {
    if (!count || !count.folio) return
    const exists = pendingFinalizedCounts.some(item => item.folio === count.folio)
    if (!exists) pendingFinalizedCounts.push(count)
    savePendingFinalizedCounts()
  }

  function removePendingFinalizedCount(folio) {
    const before = pendingFinalizedCounts.length
    pendingFinalizedCounts = pendingFinalizedCounts.filter(item => item.folio !== folio)
    if (pendingFinalizedCounts.length !== before) savePendingFinalizedCounts()
  }

  function queueCustomCode(item) {
    if (!item || !item.code) return
    const normalized = normalizeCode(item.code)
    const index = pendingCustomCodes.findIndex(row => normalizeCode(row.code) === normalized)
    if (index >= 0) {
      pendingCustomCodes[index] = { ...pendingCustomCodes[index], ...item, code: normalized }
    } else {
      pendingCustomCodes.push({ ...item, code: normalized })
    }
    savePendingCustomCodes()
  }

  function removePendingCustomCode(code) {
    const normalized = normalizeCode(code)
    const before = pendingCustomCodes.length
    pendingCustomCodes = pendingCustomCodes.filter(item => normalizeCode(item.code) !== normalized)
    if (pendingCustomCodes.length !== before) savePendingCustomCodes()
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

  async function loadRemoteActiveCount() {
    if (!supabaseClient || !store) return null

    const { data: row, error } = await supabaseClient
      .from('inventory_active_counts')
      .select('store_slug, local_id, started_at, updated_at, total_pieces, movement_count, active_count, code_totals, comparison_totals, dashboard')
      .eq('store_slug', store.slug)
      .maybeSingle()

    if (error) throw error
    if (!row || !row.active_count) return null
    return fromRemoteActiveCount(row)
  }

  function mergeRemoteActiveCount(remote) {
    if (!remote) return false
    if (readOnlyMode) {
      activeCount = remote
      return true
    }

    const localStarted = new Date(activeCount && activeCount.startedAt || 0).getTime() || 0
    const remoteStarted = new Date(remote.startedAt || 0).getTime() || 0

    // Un conteo finalizado genera un ID nuevo. Nunca mezclar el conteo viejo de la
    // nube con ese conteo nuevo, aunque la limpieza remota tarde unos segundos.
    if (activeCount && activeCount.id !== remote.id) {
      if (localStarted >= remoteStarted) return false
      activeCount = remote
      saveActiveCount()
      return true
    }

    // Los ids borrados (en este dispositivo o en otro) se juntan para que ningun
    // refresco o sincronizacion vuelva a traer de regreso un movimiento eliminado,
    // aunque la nube todavia tenga guardada la version vieja del conteo.
    const localDeleted = Array.isArray(activeCount.deletedMovementIds) ? activeCount.deletedMovementIds : []
    const remoteDeleted = Array.isArray(remote.deletedMovementIds) ? remote.deletedMovementIds : []
    const deletedIds = new Set([...localDeleted, ...remoteDeleted])
    activeCount.deletedMovementIds = Array.from(deletedIds)

    const before = activeCount && Array.isArray(activeCount.movements) ? activeCount.movements.length : 0
    const incomingMovements = remote.movements.filter(movement => !movement || !deletedIds.has(movement.id))
    const merged = mergeMovementLists(activeCount.movements, incomingMovements)
    activeCount.movements = merged.filter(movement => !movement || !deletedIds.has(movement.id))
    if (remoteStarted < localStarted) activeCount.startedAt = remote.startedAt
    if (activeCount.movements.length !== before) saveActiveCount()
    return activeCount.movements.length !== before
  }

  function fromRemoteActiveCount(row) {
    const count = row.active_count
    if (!count || !Array.isArray(count.movements)) return null
    return {
      id: row.local_id || count.id || createId('count'),
      storeSlug: row.store_slug,
      startedAt: row.started_at || count.startedAt,
      movements: count.movements,
      deletedMovementIds: Array.isArray(count.deletedMovementIds) ? count.deletedMovementIds : [],
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

  function mergeMovementLists(current, incoming) {
    const byId = new Map()
    incoming.concat(current).forEach(movement => {
      if (!movement || !movement.id) return
      const existing = byId.get(movement.id)
      // Si el mismo id llega de las dos listas (por ejemplo una correccion), se
      // conserva la version con el "updatedAt" mas reciente en vez de simplemente
      // quedarnos con la ultima que se proceso.
      if (!existing) {
        byId.set(movement.id, movement)
        return
      }
      const existingTime = new Date(existing.updatedAt || existing.createdAt || 0).getTime() || 0
      const candidateTime = new Date(movement.updatedAt || movement.createdAt || 0).getTime() || 0
      if (candidateTime >= existingTime) byId.set(movement.id, movement)
    })
    return Array.from(byId.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }

  function applyRemoteStocks(rows, options = {}) {
    let changed = false
    rows.forEach(row => {
      if (!row || !row.store_slug || !row.expected_by_quality) return
      // Aceptar todos los codigos del archivo. Antes se descartaba el stock cuando
      // muchos codigos aun no existian en el catalogo del dispositivo, dejando el
      // inventario viejo aparentemente "pegado".
      const expectedByProduct = normalizeProductStockObject(row.expected_by_quality, true)
      if (!Object.keys(expectedByProduct).length && Number(row.total_stock) > 0) return
      const uploadedAt = row.uploaded_at || new Date().toISOString()
      const current = stockOverrides[row.store_slug]
      if (!options.force && current && stockTimestamp(current.uploadedAt) > stockTimestamp(uploadedAt)) return

      const next = {
        sourceName: row.source_name || 'stock cargado',
        sourceType: row.source_type || 'archivo',
        uploadedAt,
        totalStock: Number(row.total_stock) || 0,
        expectedByProduct,
      }
      if (sameStockOverride(current, next)) return

      stockOverrides[row.store_slug] = next
      changed = true
    })
    if (changed) saveStockOverrides()
    return changed
  }

  function sameStockOverride(current, next) {
    if (!current || !next) return false
    return String(current.sourceName || '') === String(next.sourceName || '')
      && String(current.sourceType || '') === String(next.sourceType || '')
      && stockTimestamp(current.uploadedAt) === stockTimestamp(next.uploadedAt)
      && Number(current.totalStock) === Number(next.totalStock)
      && JSON.stringify(normalizeProductStockObject(current.expectedByProduct || {}, true)) === JSON.stringify(next.expectedByProduct || {})
  }

  function stockTimestamp(value) {
    const time = new Date(value || 0).getTime()
    return Number.isFinite(time) ? time : 0
  }

  function applyRemoteCustomCodes(rows) {
    rows.forEach(row => {
      const item = fromRemoteCustomCode(row)
      if (item) addCustomCode(item, true)
    })
    saveCustomCodes()
    refreshCatalogIndex()
  }

  function fromRemoteCustomCode(row) {
    if (!row || !row.code || !row.product_name) return null
    return {
      code: normalizeCode(row.code),
      qualityName: String(row.quality_name || row.product_name).trim().toUpperCase(),
      systemQuality: String(row.system_quality || row.product_name).trim().toUpperCase(),
      productName: String(row.product_name).trim().toUpperCase(),
      custom: true,
      createdAt: row.created_at || new Date().toISOString(),
      createdByStore: row.created_by_store || '',
      source: row.source || 'manual',
    }
  }

  function addCustomCode(item, skipSave) {
    const normalized = normalizeCode(item.code)
    if (!normalized) return
    const cleanItem = {
      code: normalized,
      qualityName: String(item.qualityName || item.productName || '').trim().toUpperCase(),
      systemQuality: String(item.systemQuality || item.productName || item.qualityName || '').trim().toUpperCase(),
      productName: String(item.productName || item.qualityName || '').trim().toUpperCase(),
      custom: true,
      createdAt: item.createdAt || new Date().toISOString(),
      createdByStore: item.createdByStore || (store ? store.slug : 'gerente'),
      source: item.source || 'manual',
    }
    const index = customCodes.findIndex(row => normalizeCode(row.code) === normalized)
    if (index >= 0) {
      customCodes[index] = { ...customCodes[index], ...cleanItem }
    } else {
      customCodes.push(cleanItem)
    }
    refreshCatalogIndex()
    if (!skipSave) saveCustomCodes()
  }

  function refreshCatalogIndex() {
    const baseByCode = new Map()
    data.catalog.forEach(item => baseByCode.set(normalizeCode(item.code), item))
    const cleanCustomCodes = customCodes
      .filter(item => item && normalizeCode(item.code) && !baseByCode.has(normalizeCode(item.code)))
      .map(item => ({
        ...item,
        code: normalizeCode(item.code),
        qualityName: String(item.qualityName || item.productName || '').trim().toUpperCase(),
        systemQuality: String(item.systemQuality || item.productName || item.qualityName || '').trim().toUpperCase(),
        productName: String(item.productName || item.qualityName || '').trim().toUpperCase(),
      }))

    catalogItems = data.catalog.concat(cleanCustomCodes)
    catalogEntries = buildCatalogEntries(catalogItems, data.codeAliases)
    catalogByCode = new Map(catalogItems.map(item => [normalizeCode(item.code), item]))
  }

  async function uploadStoreStock(storeSlug, file) {
    const storeItem = data.stores.find(item => item.slug === storeSlug)
    if (!storeItem) return

    if (stockUploadInProgress) {
      const message = 'Ya hay una carga de stock en proceso. Espera a que termine para subir otro archivo.'
      setDashboardStatus(message)
      window.alert(message)
      return
    }
    if (!cloudSyncEnabled) {
      const message = 'No puedo cargar stock compartido porque Supabase no esta configurado en esta publicacion.'
      window.alert(`${message}\nConfigura SUPABASE_URL y SUPABASE_ANON_KEY en Netlify y vuelve a publicar.`)
      setDashboardStatus(message)
      return
    }

    const setStatus = text => setDashboardStatus(text)

    setStatus(`Leyendo ${file.name} (${formatFileSize(file.size)})...`)
    stockUploadInProgress = true

    try {
      await pauseForPaint()
      const parsed = await parseInventoryFile(file, setStatus)
      const expectedByProduct = parsed.expectedByProduct || {}
      const totalStock = Object.values(expectedByProduct).reduce((sum, value) => sum + (Number(value) || 0), 0)
      if (!Object.keys(expectedByProduct).length) throw new Error('No encontre productos con piezas.')

      const catalogAdditions = uniqueCustomCodeItems(parsed.catalogAdditions || [])
      if (catalogAdditions.length) {
        // Se agregan de inmediato al catalogo local, pero no se bloquea la carga del
        // stock esperando cientos o miles de codigos. La sincronizacion continua al fondo.
        setStatus(`Preparando ${formatNumber(catalogAdditions.length)} codigos nuevos...`)
        catalogAdditions.forEach(item => addCustomCode(item))
        saveCustomCodes()
        refreshCatalogIndex()
      }

      const override = {
        sourceName: file.name,
        sourceType: file.type || file.name.split('.').pop() || 'archivo',
        uploadedAt: new Date().toISOString(),
        totalStock,
        expectedByProduct,
      }

      setStatus(`Guardando stock de ${storeItem.name} en nube...`)
      await pauseForPaint()
      const savedRow = await saveRemoteStoreStock(storeSlug, override)
      applyRemoteStocks([savedRow], { force: true })
      await fetchRemoteStock()

      const savedStock = stockOverrides[storeSlug] || override
      setStatus(`${storeItem.name}: stock cargado con ${formatNumber(savedStock.totalStock)} pz. Actualizando pantallas...`)
      renderDashboardContent()
      bindDashboardButtons()

      if (catalogAdditions.length) {
        syncCustomCodes(catalogAdditions).then(() => {
          setStatus(`${storeItem.name}: stock vigente ${formatNumber(savedStock.totalStock)} pz. Codigos sincronizados.`)
        }).catch(() => {
          setStatus(`${storeItem.name}: stock vigente ${formatNumber(savedStock.totalStock)} pz. Algunos nombres se sincronizaran al recuperar conexion.`)
        })
      } else {
        setStatus(`${storeItem.name}: stock vigente ${formatNumber(savedStock.totalStock)} pz.`)
      }
    } catch (error) {
      window.alert(`No pude cargar el inventario de ${storeItem.name}.\n${error.message || 'Revisa el archivo.'}`)
      setStatus('Carga cancelada.')
    } finally {
      stockUploadInProgress = false
    }
  }

  async function saveRemoteStoreStock(storeSlug, override) {
    const payload = {
      store_slug: storeSlug,
      source_name: override.sourceName,
      source_type: override.sourceType,
      uploaded_at: override.uploadedAt,
      total_stock: override.totalStock,
      expected_by_quality: override.expectedByProduct,
    }

    const { data: row, error } = await supabaseClient
      .from('inventory_store_stocks')
      .upsert(payload, { onConflict: 'store_slug' })
      .select('store_slug, source_name, source_type, uploaded_at, total_stock, expected_by_quality')
      .maybeSingle()

    if (error) throw new Error(`No se pudo guardar el stock en la nube: ${error.message}`)
    return row || payload
  }

  async function resetStoreStockAfterClosure(storeSlug) {
    const emptyOverride = {
      sourceName: 'Cierre de conteo',
      sourceType: 'reset',
      uploadedAt: new Date().toISOString(),
      totalStock: 0,
      expectedByProduct: {},
    }

    // Optimista: se refleja de inmediato en este dispositivo aunque la nube tarde o falle.
    stockOverrides[storeSlug] = { ...emptyOverride }
    saveStockOverrides()

    if (!cloudSyncEnabled) return

    try {
      const savedRow = await saveRemoteStoreStock(storeSlug, emptyOverride)
      applyRemoteStocks([savedRow], { force: true })
    } catch (error) {
      // El cierre del conteo ya se guardo; si el reinicio de stock en la nube falla
      // (por ejemplo sin internet), este dispositivo ya quedo en 0 y la nube se
      // actualizara la proxima vez que haya conexion y se repita esta accion.
      console.warn('No se pudo reiniciar el stock en la nube tras el cierre:', error)
    }
  }

  async function parseInventoryFile(file, setStatus) {
    // Se reinicia en cada carga: los codigos generados para productos sin codigo
    // de barras son deterministas (mismo nombre = mismo codigo), pero este mapa
    // evita duplicar la entrada de catalogo varias veces dentro del mismo archivo.
    fallbackCodeCache = new Map()

    const name = file.name.toLowerCase()
    if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')) {
      if (setStatus) setStatus(`Abriendo hoja de calculo ${file.name}...`)
      await pauseForPaint()
      const buffer = await file.arrayBuffer()
      if (setStatus) setStatus(`Procesando datos de ${file.name}...`)
      await pauseForPaint()
      return parseSpreadsheetInventory(buffer, name)
    }
    if (name.endsWith('.pdf')) {
      if (setStatus) setStatus(`Leyendo PDF ${file.name}...`)
      await pauseForPaint()
      return parsePdfInventory(await file.arrayBuffer())
    }
    throw new Error('Usa un archivo Excel, CSV o PDF.')
  }

  function parseSpreadsheetInventory(buffer, name) {
    if (!window.XLSX) throw new Error('No cargo el lector de Excel. Recarga la pagina.')
    const workbook = window.XLSX.read(buffer, { type: 'array', dense: true, cellDates: false, cellText: false })
    const sheetNames = workbook.SheetNames || []
    if (!sheetNames.length) throw new Error(`No encontre hojas en ${name}.`)

    // Antes solo se leia la primera hoja del archivo. Si el Excel trae varias
    // pestanas con productos (por ejemplo una por categoria), las demas se
    // ignoraban por completo. Ahora se procesan todas y se suman.
    const combinedExpected = {}
    const combinedAdditions = []
    const seenAdditionCodes = new Set()
    let matchedAnySheet = false

    sheetNames.forEach(sheetName => {
      const sheet = workbook.Sheets[sheetName]
      if (!sheet) return
      const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '', blankrows: false })
      if (!rows.length) return

      let parsed = null
      try {
        parsed = extractInventoryRows(rows, `${name} (${sheetName})`)
      } catch {
        parsed = null
      }
      if (!parsed) return

      matchedAnySheet = true
      Object.entries(parsed.expectedByProduct || {}).forEach(([code, quantity]) => {
        const key = normalizeCode(code)
        if (!key) return
        combinedExpected[key] = (combinedExpected[key] || 0) + (Number(quantity) || 0)
      })
      ;(parsed.catalogAdditions || []).forEach(item => {
        const code = normalizeCode(item && item.code)
        if (!code || seenAdditionCodes.has(code)) return
        seenAdditionCodes.add(code)
        combinedAdditions.push(item)
      })
    })

    if (!matchedAnySheet) throw new Error(`No encontre columnas de producto y piezas en ${name}.`)

    return {
      expectedByProduct: combinedExpected,
      catalogAdditions: combinedAdditions,
    }
  }

  async function parsePdfInventory(buffer) {
    if (!window.pdfjsLib) throw new Error('No cargo el lector de PDF. Recarga la pagina.')
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'
    const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise
    const rows = []

    for (let index = 1; index <= pdf.numPages; index += 1) {
      const page = await pdf.getPage(index)
      const content = await page.getTextContent()
      const text = content.items.map(item => item.str).join('\n')
      text.split(/\n+/).forEach(line => {
        const match = line.trim().match(/^(.+?)\s+(-?[\d,]+)$/)
        if (match) rows.push([match[1], match[2]])
      })
    }

    return extractInventoryRows(rows, 'pdf')
  }

  function extractInventoryRows(rows, sourceName) {
    const productStock = extractProductInventoryRows(rows)
    if (productStock && Object.keys(productStock.expectedByProduct).length) return productStock

    const output = {}
    const catalogAdditions = []
    rows.forEach(row => {
      const cells = Array.isArray(row) ? row.map(cell => String(cell || '').trim()).filter(Boolean) : []
      if (cells.length < 2) return
      const joined = normalizeSearch(cells.join(' '))
      if (joined.includes('codigo') || joined.includes('cantidadamano') || joined.includes('pz') && joined.includes('sistema')) return

      const qtyIndex = cells.findIndex(cell => parseLooseNumber(cell) !== null)
      if (qtyIndex < 0) return
      const productCell = cells.find((cell, index) => index !== qtyIndex && parseLooseNumber(cell) === null)
      if (!productCell) return

      const quantity = parseLooseNumber(cells[qtyIndex])
      if (quantity === null) return
      // Aunque el producto no tenga nada parecido en el catalogo, se genera un
      // codigo nuevo para el en vez de descartar sus piezas.
      const productCode = resolveInventoryProductCodeOrCreate(productCell, '', [], catalogAdditions)
      if (!productCode) return
      output[productCode] = (output[productCode] || 0) + quantity
    })

    if (!Object.keys(output).length) throw new Error(`No encontre columnas de producto y piezas en ${sourceName}.`)
    return {
      expectedByProduct: normalizeProductStockObject(output, true),
      catalogAdditions,
    }
  }

  function extractProductInventoryRows(rows) {
    const headerIndex = rows.findIndex(row => {
      const normalized = (Array.isArray(row) ? row : []).map(cell => normalizeQuality(cell))
      return normalized.some(cell => cell.includes('CODIGO DE BARRAS'))
        && normalized.some(cell => cell === 'NOMBRE')
        && normalized.some(cell => cell.includes('CANTIDAD A MANO'))
    })
    if (headerIndex < 0) return null

    const headers = rows[headerIndex].map(cell => normalizeQuality(cell))
    const codeIndex = headers.findIndex(cell => cell.includes('CODIGO DE BARRAS') || cell === 'CODIGO' || cell === 'CODIGO BARRAS')
    const nameIndex = headers.findIndex(cell => cell === 'NOMBRE')
    const variantIndex = headers.findIndex(cell => cell.includes('VALORES DE LAS VARIANTES'))
    const qtyIndex = headers.findIndex(cell => cell.includes('CANTIDAD A MANO'))
    if (codeIndex < 0 || nameIndex < 0 || qtyIndex < 0) return null

    const fileProducts = []
    const missingStockRows = []
    let currentProduct = null

    rows.slice(headerIndex + 1).forEach(row => {
      const cells = Array.isArray(row) ? row : []
      const codeRaw = String(cells[codeIndex] || '').trim().toUpperCase()
      const code = normalizeCode(codeRaw)
      const productName = String(cells[nameIndex] || '').trim().toUpperCase()
      const variant = variantIndex >= 0 ? String(cells[variantIndex] || '').trim().toUpperCase() : ''
      const quantity = parseLooseNumber(cells[qtyIndex]) || 0

      if (code) {
        currentProduct = {
          code,
          displayCode: codeRaw || code,
          productName,
          variants: variant ? [variant] : [],
          quantity,
        }
        fileProducts.push(currentProduct)
        return
      }

      if (!productName && variant && currentProduct) {
        currentProduct.variants.push(variant)
        return
      }

      // Antes se exigia que "quantity" fuera distinto de 0 para siquiera
      // considerar la fila; eso descartaba en silencio los productos en cero
      // que no tienen codigo de barras propio.
      if (productName) {
        missingStockRows.push({ productName, variant, quantity })
      }
    })

    const expectedByProduct = {}
    const catalogAdditions = []
    fileProducts.forEach(product => {
      const code = normalizeCode(product.code)
      if (!code) return
      expectedByProduct[code] = (expectedByProduct[code] || 0) + product.quantity
      if (!catalogByCode.has(code)) catalogAdditions.push(productToCatalogItem(product))
    })

    missingStockRows.forEach(row => {
      // Si no hay nada parecido en el catalogo ni en el archivo, se crea un
      // codigo nuevo para el producto en vez de perder sus piezas.
      const code = resolveInventoryProductCodeOrCreate(row.productName, row.variant, fileProducts, catalogAdditions)
      if (!code) return
      expectedByProduct[code] = (expectedByProduct[code] || 0) + row.quantity
    })

    return {
      expectedByProduct: normalizeProductStockObject(expectedByProduct, true),
      catalogAdditions,
    }
  }

  function productToCatalogItem(product) {
    const label = productInventoryLabel(product.productName, product.variants)
    return {
      code: product.code,
      qualityName: label,
      systemQuality: label,
      productName: product.productName || label,
      variantName: product.variants.join(' - '),
      custom: true,
      createdAt: new Date().toISOString(),
      createdByStore: store ? store.slug : 'gerente',
      source: 'stock-upload',
    }
  }

  function productInventoryLabel(productName, variants) {
    const cleanName = String(productName || '').trim().toUpperCase()
    const cleanVariants = (variants || []).map(item => String(item || '').trim().toUpperCase()).filter(Boolean)
    return [cleanName, ...cleanVariants].filter(Boolean).join(' - ')
  }

  function resolveInventoryProductCode(productName, variant, fileProducts) {
    const exactCode = normalizeCode(productName)
    if (exactCode && (catalogByCode.has(exactCode) || (fileProducts || []).some(product => normalizeCode(product.code) === exactCode))) {
      return exactCode
    }

    const candidates = [
      ...(fileProducts || []).map(product => ({
        code: normalizeCode(product.code),
        text: `${product.displayCode || product.code} ${product.productName} ${productInventoryLabel(product.productName, product.variants)}`,
      })),
      ...catalogItems.map(item => ({
        code: normalizeCode(item.code),
        text: `${item.code} ${item.qualityName} ${item.systemQuality} ${item.productName} ${item.variantName || ''}`,
      })),
    ].filter(item => item.code)

    let best = null
    candidates.forEach(candidate => {
      const score = productMatchScore(productName, variant, candidate)
      if (!best || score > best.score) best = { ...candidate, score }
    })

    return best && best.score >= 18 ? best.code : ''
  }

  // A diferencia de resolveInventoryProductCode (que puede regresar '' si no
  // encuentra nada parecido), esta version nunca deja piezas sin contar: si no
  // hay ningun codigo ni producto parecido, crea uno nuevo a partir del nombre
  // para que el stock de ese producto se cargue de todas formas.
  function resolveInventoryProductCodeOrCreate(productName, variant, fileProducts, catalogAdditions) {
    const matchedCode = resolveInventoryProductCode(productName, variant, fileProducts)
    if (matchedCode) return matchedCode

    const cleanName = String(productName || '').trim()
    if (!cleanName) return ''

    const label = productInventoryLabel(cleanName, variant ? [variant] : [])
    const dedupeKey = label || cleanName

    let code = fallbackCodeCache.get(dedupeKey)
    if (!code) {
      code = generateFallbackProductCode(dedupeKey)
      fallbackCodeCache.set(dedupeKey, code)
    }

    if (!catalogByCode.has(code) && Array.isArray(catalogAdditions) && !catalogAdditions.some(item => normalizeCode(item && item.code) === code)) {
      catalogAdditions.push({
        code,
        qualityName: label || cleanName,
        systemQuality: label || cleanName,
        productName: cleanName,
        variantName: variant || '',
        custom: true,
        createdAt: new Date().toISOString(),
        createdByStore: store ? store.slug : 'gerente',
        source: 'stock-upload',
      })
    }

    return code
  }

  function generateFallbackProductCode(seed) {
    // normalize('NFD') separa acentos de su letra base (por ejemplo "Á" en "A" +
    // marca de acento); el siguiente replace se queda solo con A-Z0-9, asi que
    // tanto la marca de acento como cualquier otro simbolo quedan fuera.
    const base = String(seed || 'PRODUCTO')
      .toUpperCase()
      .normalize('NFD')
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 18) || 'PRODUCTO'

    let hash = 0
    const text = String(seed || '')
    for (let index = 0; index < text.length; index += 1) {
      hash = (hash * 31 + text.charCodeAt(index)) >>> 0
    }

    return `AUTO${base}${hash.toString(36).toUpperCase()}`
  }

  function productMatchScore(productName, variant, candidate) {
    const wantedTokens = tokenSet(`${productName} ${variant}`)
    const candidateTokens = tokenSet(candidate.text)
    if (!wantedTokens.size || !candidateTokens.size) return 0

    let score = 0
    wantedTokens.forEach(token => {
      if (candidateTokens.has(token)) score += 10
    })

    const wantedText = normalizeQuality(productName)
    const candidateText = normalizeQuality(candidate.text)
    if (normalizeCode(productName) === candidate.code) score += 100
    if (wantedText && candidateText.includes(wantedText)) score += 40
    if (candidateText && wantedText.includes(candidateText)) score += 20
    return score
  }

  function tokenSet(value) {
    return new Set(normalizeQuality(value).split(' ').filter(token => token.length > 1))
  }

  function parseLooseNumber(value) {
    const cleaned = String(value ?? '').replace(/,/g, '').trim()
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null
    return Math.round(Number(cleaned))
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value)
    return String(value || '').replace(/["\\]/g, '\\$&')
  }

  function setDashboardStatus(text) {
    const syncLabel = app.querySelector('[data-dashboard-sync]')
    if (syncLabel) syncLabel.textContent = text
  }

  function normalizeRemoteProductStock(stock) {
    const entries = Object.entries(stock || {})
    if (!entries.length) return {}
    const catalogMatches = entries.filter(([code]) => catalogByCode.has(normalizeCode(code))).length
    if (catalogMatches / entries.length < 0.6) return {}
    return normalizeProductStockObject(stock)
  }

  function normalizeProductStockObject(stock, allowUnknown) {
    const output = {}
    Object.entries(stock || {}).forEach(([code, quantity]) => {
      const key = normalizeCode(code)
      if (!key) return
      if (!allowUnknown && !catalogByCode.has(key)) return
      output[key] = (output[key] || 0) + (Number(quantity) || 0)
    })
    return output
  }

  function uniqueCustomCodeItems(items) {
    const byCode = new Map()
    ;(items || []).forEach(item => {
      const code = normalizeCode(item && item.code)
      const productName = String(item && (item.productName || item.qualityName || '') || '').trim().toUpperCase()
      if (!code || !productName) return
      byCode.set(code, {
        code,
        qualityName: String(item.qualityName || productName).trim().toUpperCase(),
        systemQuality: String(item.systemQuality || productName).trim().toUpperCase(),
        productName,
        custom: true,
        createdAt: item.createdAt || new Date().toISOString(),
        createdByStore: item.createdByStore || (store ? store.slug : 'gerente'),
        source: item.source || 'manual',
      })
    })
    return Array.from(byCode.values())
  }

  function chunkArray(items, size) {
    const chunks = []
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size))
    }
    return chunks
  }

  function pauseForPaint() {
    return new Promise(resolve => {
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => window.setTimeout(resolve, 0))
        return
      }
      window.setTimeout(resolve, 0)
    })
  }

  function formatFileSize(bytes) {
    const size = Number(bytes) || 0
    if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
    if (size >= 1024) return `${Math.round(size / 1024)} KB`
    return `${size} B`
  }

  function createSupabaseClient() {
    const config = window.INVENTORY_CONFIG || {}
    if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase) return null
    return window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey)
  }

  function isAdminUnlocked() {
    return localStorage.getItem('inventario-scanner:admin-unlocked:v1') === '1'
  }

  async function verifyAdminPin(pin) {
    const config = window.INVENTORY_CONFIG || {}
    const expectedHash = config.adminPinHash || '0ab5946ad63b762a4c7ce7f5e9d92bb764e2a10783cbd6ceb9a78a628779dff4'
    const cleanPin = String(pin || '').trim()
    return (await hashText(cleanPin)) === expectedHash || (await hashText(cleanPin.toUpperCase())) === expectedHash
  }

  async function hashText(text) {
    if (window.crypto && window.crypto.subtle) {
      const bytes = new TextEncoder().encode(text)
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', bytes)
      return Array.from(new Uint8Array(hashBuffer)).map(byte => byte.toString(16).padStart(2, '0')).join('')
    }
    return ''
  }

  function createEmptyCount(storeSlug) {
    return {
      id: createId('count'),
      storeSlug,
      startedAt: new Date().toISOString(),
      movements: [],
      deletedMovementIds: [],
    }
  }

  function saveActiveCount() {
    if (!store || !activeCount) return false
    const saved = writeLocalJson(activeKey(store.slug), activeCount)
    writeLocalJson(activeBackupKey(store.slug), {
      savedAt: new Date().toISOString(),
      count: activeCount,
    }, true)
    return saved
  }

  function savePastCounts() {
    writeLocalJson(pastKey(store.slug), pastCounts)
  }

  function readJson(key) {
    try {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }

  function writeLocalJson(key, value, silent) {
    try {
      localStorage.setItem(key, JSON.stringify(value))
      return true
    } catch {
      if (!silent) window.alert('No se pudo guardar en este dispositivo. No cierres la pagina y avisa al gerente.')
      return false
    }
  }

  function activeKey(storeSlug) {
    return `inventario-scanner:active:${storeSlug}:v1`
  }

  function activeBackupKey(storeSlug) {
    return `inventario-scanner:active-backup:${storeSlug}:v1`
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

  function normalizeQuality(value) {
    return String(value || '')
      .trim()
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Z0-9&]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
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
    if (!message) {
      const addButton = app.querySelector('[data-add-unknown]')
      if (addButton) addButton.hidden = true
    }
  }

  function setQtyError(message) {
    const el = app.querySelector('[data-qty-error]')
    el.hidden = !message
    el.textContent = message
  }

  function setCodeError(message) {
    const el = app.querySelector('[data-code-error]')
    if (!el) return
    el.hidden = !message
    el.textContent = message
  }

  function setEditError(message) {
    const el = app.querySelector('[data-edit-error]')
    if (!el) return
    el.hidden = !message
    el.textContent = message
  }

  function focusScanner() {
    if (readOnlyMode) return
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

  function syncStatusText() {
    const pending = pendingFinalizedCounts.length + pendingCustomCodes.length
    if (!navigator.onLine) return ' - sin internet, guardado local'
    if (pending) return ` - ${formatNumber(pending)} pendiente(s) de subir`
    return ' - nube activa'
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
