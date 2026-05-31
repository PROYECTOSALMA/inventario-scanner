window.INVENTORY_DATA = {
  stores: [
    { slug: 'elite', name: 'Elite', color: '#516a6f' },
    { slug: 'lineas-originales', name: 'Lineas Originales', color: '#b7831f' },
    { slug: 'club-jeans', name: 'Club Jeans', color: '#111827' },
    { slug: 'miguel-aleman', name: 'Miguel Aleman', color: '#36516f' },
    { slug: 'almacen-general', name: 'Almacen General', color: '#173044' },
    { slug: 'zapotlanejo', name: 'Zapotlanejo', color: '#66706a' },
    { slug: 'denim-click', name: 'Denim Click', color: '#0f766e' },
  ],

  aliases: {
    zoa: 'almacen-general',
    almacen: 'almacen-general',
    denimclick: 'denim-click',
    'outlet-zapotlanejo': 'zapotlanejo',
    'zapotlanejo-outlet': 'zapotlanejo',
  },

  // Reemplazar con los codigos del PDF.
  // code: codigo de etiqueta
  // qualityName: nombre exacto de la calidad/modelo
  // systemQuality: calidad consolidada para el comparativo del sistema
  catalog: [
    { code: '0501', qualityName: 'Jeans modelo 0501', systemQuality: 'Linea' },
    { code: '0505', qualityName: 'Jeans modelo 0505', systemQuality: 'Linea' },
    { code: '0510', qualityName: 'Jeans modelo 0510', systemQuality: 'Linea' },
    { code: 'CAE3511', qualityName: 'Jeans CAE3511', systemQuality: 'Linea' },
    { code: '0601', qualityName: 'Jeans premium 0601', systemQuality: 'Premium' },
    { code: '0605', qualityName: 'Jeans premium 0605', systemQuality: 'Premium' },
    { code: '0701', qualityName: 'Jeans outlet 0701', systemQuality: 'Outlet' },
    { code: '0801', qualityName: 'Basico 0801', systemQuality: 'Basico' },
  ],

  // Reemplazar con el inventario del sistema por tienda y calidad.
  expectedByQuality: {
    Linea: {
      elite: 0,
      'lineas-originales': 0,
      'club-jeans': 0,
      'miguel-aleman': 0,
      'almacen-general': 0,
      zapotlanejo: 0,
      'denim-click': 0,
    },
    Premium: {
      elite: 0,
      'lineas-originales': 0,
      'club-jeans': 0,
      'miguel-aleman': 0,
      'almacen-general': 0,
      zapotlanejo: 0,
      'denim-click': 0,
    },
    Outlet: {
      elite: 0,
      'lineas-originales': 0,
      'club-jeans': 0,
      'miguel-aleman': 0,
      'almacen-general': 0,
      zapotlanejo: 0,
      'denim-click': 0,
    },
    Basico: {
      elite: 0,
      'lineas-originales': 0,
      'club-jeans': 0,
      'miguel-aleman': 0,
      'almacen-general': 0,
      zapotlanejo: 0,
      'denim-click': 0,
    },
  },
}
