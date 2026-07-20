/**
 * Convert Colossus variant XML into JSON for the web app.
 * Usage: node scripts/convert-variant.mjs [Default|Abyssal6|Abyssal3|Abyssal9 ...]
 * Default: converts Default + Abyssal6 + Abyssal3 + Abyssal9
 */
import { XMLParser } from 'fast-xml-parser'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')
const variantsRoot = path.join(root, 'Colossus/variants')
const outRoot = path.join(__dirname, '../public/variants')

const DEFAULT_VARIANTS = ['Default', 'Abyssal6', 'Abyssal3', 'Abyssal9']

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  isArray: (name, jpath) => {
    if (name === 'terrain' && jpath.includes('terrains')) return true
    if (name === 'depend') return true
    return [
      'hex',
      'exit',
      'creature',
      'recruit',
      'starting',
      'acquirable',
      'battlehex',
      'battlehexref',
      'border',
    ].includes(name)
  },
})

function readXml(file) {
  return parser.parse(fs.readFileSync(file, 'utf8'))
}

function asArray(value) {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function variantDir(name) {
  return path.join(variantsRoot, name)
}

function findVariantXml(dir, suffix) {
  const base = path.basename(dir)
  const preferred = path.join(dir, `${base}${suffix}.xml`)
  if (fs.existsSync(preferred)) return preferred
  const hits = fs.readdirSync(dir).filter((f) => f.endsWith(`${suffix}.xml`))
  if (hits.length === 0) throw new Error(`No *${suffix}.xml in ${dir}`)
  return path.join(dir, hits[0])
}

function convertCreatures(doc) {
  return asArray(doc.creatures?.creature).map((c) => ({
    name: c.name,
    power: Number(c.power),
    skill: Number(c.skill),
    rangestrikes: c.rangestrikes === 'true',
    flies: c.flies === 'true',
    magicMissile: c.magic_missile === 'true',
    summonable: c.summonable === 'true',
    lord: c.lord === 'true',
    demilord: c.demilord === 'true',
    count: Number(c.count),
    pluralName: c.plural_name,
    baseColor: c.base_color,
    native: {
      Brambles: c.Brambles === 'true',
      Drift: c.Drift === 'true',
      Bog: c.Bog === 'true',
      Sand: c.Sand === 'true',
      slope: c.slope === 'true',
      Volcano: c.Volcano === 'true',
      river: c.river === 'true',
      Stone: c.Stone === 'true',
      Tree: c.Tree === 'true',
      Lake: c.Lake === 'true',
    },
  }))
}

function convertTerrains(doc) {
  const terrains = asArray(doc.terrains?.terrain).map((t) => ({
    name: t.name,
    color: t.color,
    regularRecruit: t.regular_recruit === 'True' || t.regular_recruit === 'true',
    recruits: asArray(t.recruit).map((r) => ({
      name: r.name,
      number: Number(r.number),
    })),
    starting: asArray(t.starting).map((s) => ({
      name: s.name,
      number: Number(s.number),
    })),
  }))
  const acquirables = asArray(doc.terrains?.acquirable).map((a) => ({
    name: a.name,
    points: Number(a.points),
  }))
  const titanImprove =
    doc.terrains?.titan_improve?.points != null
      ? Number(doc.terrains.titan_improve.points)
      : 100
  const titanTeleport =
    doc.terrains?.titan_teleport?.points != null
      ? Number(doc.terrains.titan_teleport.points)
      : 400
  return { terrains, acquirables, titanImprove, titanTeleport }
}

function convertMap(doc) {
  const board = doc.board
  return {
    width: Number(board.width),
    height: Number(board.height),
    hexes: asArray(board.hex).map((h) => ({
      label: String(h.label),
      terrain: h.terrain,
      x: Number(h.xpos),
      y: Number(h.ypos),
      exits: asArray(h.exit).map((e) => ({
        type: e.type,
        label: String(e.label),
      })),
    })),
  }
}

function convertBattleland(file) {
  const doc = readXml(file)
  const rootEl = doc.battlemap
  return {
    terrain: rootEl.terrain,
    tower: rootEl.tower === 'True' || rootEl.tower === 'true',
    subtitle: rootEl.subtitle ?? null,
    hexes: asArray(rootEl.battlehex).map((h) => ({
      x: Number(h.x),
      y: Number(h.y),
      label: h.label != null ? String(h.label) : undefined,
      terrain: h.terrain ?? 'Plains',
      elevation: h.elevation != null ? Number(h.elevation) : 0,
      borders: asArray(h.border).map((b) => ({
        number: Number(b.number),
        type: String(b.type),
      })),
    })),
    startlist: asArray(rootEl.startlist?.battlehexref ?? rootEl.startlist?.battlehex).map((h) =>
      String(h.label ?? h),
    ),
  }
}

function loadBattlelandsFromDir(dir, into) {
  const battleDir = path.join(dir, 'Battlelands')
  if (!fs.existsSync(battleDir)) return
  for (const file of fs.readdirSync(battleDir)) {
    if (!file.endsWith('.xml') || file === 'battlemap.dtd') continue
    const name = path.basename(file, '.xml')
    into[name] = convertBattleland(path.join(battleDir, file))
  }
}

function copyImages(srcDir, dstDir, intoSet) {
  if (!fs.existsSync(srcDir)) return
  fs.mkdirSync(dstDir, { recursive: true })
  for (const file of fs.readdirSync(srcDir)) {
    if (file.startsWith('.') || file === 'manifest.json') continue
    const src = path.join(srcDir, file)
    if (!fs.statSync(src).isFile()) continue
    fs.copyFileSync(src, path.join(dstDir, file))
    intoSet.add(file)
  }
}

/**
 * If `Terrain.gif` / `Terrain_i.gif` are missing, copy from an alias (e.g. Mantio → Abyss).
 */
function ensureTerrainAlias(imagesDst, imageFiles, terrainName, searchDirs, aliasBase) {
  const targets = [`${terrainName}.gif`, `${terrainName}_i.gif`]
  const sources = [`${aliasBase}.gif`, `${aliasBase}_i.gif`]
  for (let i = 0; i < targets.length; i++) {
    const destName = targets[i]
    if (imageFiles.has(destName) || fs.existsSync(path.join(imagesDst, destName))) {
      imageFiles.add(destName)
      continue
    }
    for (const dir of searchDirs) {
      const src = path.join(dir, sources[i])
      if (!fs.existsSync(src)) continue
      fs.mkdirSync(imagesDst, { recursive: true })
      fs.copyFileSync(src, path.join(imagesDst, destName))
      imageFiles.add(destName)
      console.log(`  aliased ${sources[i]} → ${destName}`)
      break
    }
  }
}

function dependNames(varDoc) {
  return asArray(varDoc.variant?.depends?.depend).map((d) => d.variant).filter(Boolean)
}

function convertOne(variantName, converting = new Set()) {
  if (converting.has(variantName)) {
    throw new Error(`Circular variant depend: ${[...converting, variantName].join(' → ')}`)
  }
  converting.add(variantName)

  const dir = variantDir(variantName)
  if (!fs.existsSync(dir)) throw new Error(`Missing variant folder: ${dir}`)

  const varDoc = readXml(findVariantXml(dir, 'Var'))
  const deps = dependNames(varDoc)

  // Dependents first — used for battleland / image fallbacks
  for (const dep of deps) {
    if (!fs.existsSync(path.join(outRoot, dep, 'variant.json'))) {
      convertOne(dep, converting)
    }
  }

  const creFile = findVariantXml(dir, 'Cre')
  const terFile = findVariantXml(dir, 'Ter')
  const mapFile = findVariantXml(dir, 'Map')

  const creatures = convertCreatures(readXml(creFile))
  const { terrains, acquirables, titanImprove, titanTeleport } = convertTerrains(readXml(terFile))
  const map = convertMap(readXml(mapFile))

  const battlelands = {}
  // Merge depend battlelands first (earlier deps overwritten by later / self)
  for (const dep of deps) {
    const depJsonPath = path.join(outRoot, dep, 'variant.json')
    if (fs.existsSync(depJsonPath)) {
      const depData = JSON.parse(fs.readFileSync(depJsonPath, 'utf8'))
      Object.assign(battlelands, depData.battlelands ?? {})
    }
  }
  // Default Tower battleland fallback when missing (Abyssal6 has Abyss but no Tower.xml)
  if (!battlelands.Tower && variantName !== 'Default') {
    const defaultTower = path.join(outRoot, 'Default', 'Battlelands', 'Tower.json')
    if (fs.existsSync(defaultTower)) {
      battlelands.Tower = JSON.parse(fs.readFileSync(defaultTower, 'utf8'))
    } else if (fs.existsSync(path.join(variantsRoot, 'Default', 'Battlelands', 'Tower.xml'))) {
      battlelands.Tower = convertBattleland(
        path.join(variantsRoot, 'Default', 'Battlelands', 'Tower.xml'),
      )
    }
  }
  loadBattlelandsFromDir(dir, battlelands)

  const maxPlayersRaw = varDoc.variant?.max_players?.num
  const towerCount = map.hexes.filter((h) => h.terrain === 'Tower').length
  const maxPlayers = maxPlayersRaw != null ? Number(maxPlayersRaw) : towerCount || 6

  const outDir = path.join(outRoot, variantName)
  fs.mkdirSync(outDir, { recursive: true })
  fs.mkdirSync(path.join(outDir, 'Battlelands'), { recursive: true })

  for (const [name, bl] of Object.entries(battlelands)) {
    fs.writeFileSync(path.join(outDir, 'Battlelands', `${name}.json`), JSON.stringify(bl, null, 2))
  }

  const variant = {
    name: varDoc.variant?.name ?? variantName,
    titanImprove,
    titanTeleport,
    maxPlayers,
    creatures,
    terrains,
    acquirables,
    map,
    battlelands,
  }
  fs.writeFileSync(path.join(outDir, 'variant.json'), JSON.stringify(variant, null, 2))

  const imagesDst = path.join(outDir, 'images')
  const imageFiles = new Set()
  // Depend images first, then own (own wins)
  for (const dep of deps) {
    copyImages(path.join(variantsRoot, dep, 'images'), imagesDst, imageFiles)
    copyImages(path.join(outRoot, dep, 'images'), imagesDst, imageFiles)
  }
  if (variantName !== 'Default') {
    copyImages(path.join(variantsRoot, 'Default', 'images'), imagesDst, imageFiles)
  }
  copyImages(path.join(dir, 'images'), imagesDst, imageFiles)

  // Prefer hand-built Abyss art (scripts/terrain-assets); never ship Mantio-labeled tiles.
  if (terrains.some((t) => t.name === 'Abyss')) {
    const localAssets = path.join(__dirname, 'terrain-assets')
    for (const name of ['Abyss.gif', 'Abyss_i.gif']) {
      const src = path.join(localAssets, name)
      if (!fs.existsSync(src)) continue
      fs.mkdirSync(imagesDst, { recursive: true })
      fs.copyFileSync(src, path.join(imagesDst, name))
      imageFiles.add(name)
    }
  }

  fs.mkdirSync(imagesDst, { recursive: true })
  fs.writeFileSync(
    path.join(imagesDst, 'manifest.json'),
    JSON.stringify([...imageFiles].sort(), null, 2),
  )

  console.log(
    `Wrote ${outDir}/variant.json — creatures ${creatures.length}, terrains ${terrains.length}, hexes ${map.hexes.length}, battlelands ${Object.keys(battlelands).length}, images ${imageFiles.size}, titanTeleport ${titanTeleport}`,
  )
  converting.delete(variantName)
}

const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const list = requested.length > 0 ? requested : DEFAULT_VARIANTS

// Always ensure Default exists first when converting Abyssal (Tower battleland / base images)
if (list.some((n) => n !== 'Default') && !list.includes('Default')) {
  convertOne('Default')
}

for (const name of list) {
  convertOne(name)
}
