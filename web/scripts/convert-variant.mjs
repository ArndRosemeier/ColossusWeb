/**
 * Convert Colossus Default variant XML into JSON for the web app.
 * Run: node scripts/convert-variant.mjs
 */
import { XMLParser } from 'fast-xml-parser'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')
const variantDir = path.join(root, 'Colossus/variants/Default')
const outDir = path.join(__dirname, '../public/variants/Default')

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  isArray: (name, jpath) => {
    // Only force arrays for repeating elements, never for attributes like hex@terrain
    if (name === 'terrain' && jpath.includes('terrains')) return true
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
  return { terrains, acquirables }
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
  const root = doc.battlemap
  return {
    terrain: root.terrain,
    tower: root.tower === 'True' || root.tower === 'true',
    subtitle: root.subtitle ?? null,
    hexes: asArray(root.battlehex).map((h) => ({
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
    startlist: asArray(root.startlist?.battlehexref ?? root.startlist?.battlehex).map((h) =>
      String(h.label ?? h),
    ),
  }
}

fs.mkdirSync(outDir, { recursive: true })
fs.mkdirSync(path.join(outDir, 'Battlelands'), { recursive: true })

const varDoc = readXml(path.join(variantDir, 'DefaultVar.xml'))
const creatures = convertCreatures(readXml(path.join(variantDir, 'DefaultCre.xml')))
const { terrains, acquirables } = convertTerrains(readXml(path.join(variantDir, 'DefaultTer.xml')))
const map = convertMap(readXml(path.join(variantDir, 'DefaultMap.xml')))

const battlelands = {}
const battleDir = path.join(variantDir, 'Battlelands')
for (const file of fs.readdirSync(battleDir)) {
  if (!file.endsWith('.xml') || file === 'battlemap.dtd') continue
  const name = path.basename(file, '.xml')
  battlelands[name] = convertBattleland(path.join(battleDir, file))
  fs.writeFileSync(path.join(outDir, 'Battlelands', `${name}.json`), JSON.stringify(battlelands[name], null, 2))
}

const variant = {
  name: varDoc.variant?.name ?? 'Default',
  creatures,
  terrains,
  acquirables,
  map,
  battlelands,
}

fs.writeFileSync(path.join(outDir, 'variant.json'), JSON.stringify(variant, null, 2))

const imagesSrc = path.join(variantDir, 'images')
const imagesDst = path.join(outDir, 'images')
if (fs.existsSync(imagesSrc)) {
  fs.mkdirSync(imagesDst, { recursive: true })
  fs.cpSync(imagesSrc, imagesDst, { recursive: true })
  const files = fs.readdirSync(imagesDst).filter((f) => !f.startsWith('.'))
  fs.writeFileSync(path.join(imagesDst, 'manifest.json'), JSON.stringify(files, null, 2))
  console.log(`Copied ${files.length} image files to ${imagesDst}`)
} else {
  console.warn(`WARNING: missing images at ${imagesSrc}`)
}

console.log(`Wrote ${outDir}/variant.json`)
console.log(`Creatures: ${creatures.length}, terrains: ${terrains.length}, hexes: ${map.hexes.length}, battlelands: ${Object.keys(battlelands).length}`)

