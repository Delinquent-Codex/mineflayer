import mineflayer from 'mineflayer'
import minecraftData from 'minecraft-data'
import { Vec3 } from 'vec3'
import { pathfinder, Movements, goals } from 'mineflayer-pathfinder'

const { GoalNear } = goals

const config = {
  host: process.env.MC_HOST ?? 'localhost',
  port: Number(process.env.MC_PORT ?? 25565),
  username: process.env.MC_USERNAME ?? 'MineflayerBot',
  version: process.env.MC_VERSION,
  auth: process.env.MC_AUTH,
  sortRadius: Number(process.env.SORT_RADIUS ?? 16),
  sortInterval: Number(process.env.SORT_INTERVAL ?? 30),
  scanInterval: Number(process.env.SORT_SCAN_INTERVAL ?? 30),
  chestSearchRadius: Number(process.env.CHEST_SEARCH_RADIUS ?? 1)
}

const clampNumber = (value, min, max, fallback) => {
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(value, min), max)
}

config.sortRadius = clampNumber(config.sortRadius, 1, 128, 16)
config.sortInterval = clampNumber(config.sortInterval, 5, 3600, 30)
config.scanInterval = clampNumber(config.scanInterval, 5, 3600, 30)
config.chestSearchRadius = clampNumber(config.chestSearchRadius, 1, 4, 1)

const bot = mineflayer.createBot({
  host: config.host,
  port: config.port,
  username: config.username,
  version: config.version,
  auth: config.auth
})

bot.loadPlugin(pathfinder)

let sorting = false
let intervalHandle = null
let targetsCache = new Map()
let categoryTargetsCache = new Map()
let lastScan = 0
let mcData = null
let itemTagsById = new Map()

const chestBlockNames = new Set(['chest', 'trapped_chest'])

const logInfo = (message) => {
  console.log(`[${new Date().toISOString()}] ${message}`)
}

const logError = (message, error) => {
  console.error(`[${new Date().toISOString()}] ${message}`, error)
}

const getItemFrameItem = (frame) => {
  const metadata = frame.metadata ?? []
  const item = metadata[8] ?? metadata[7]
  if (!item || !item.name) return null
  return item
}

const getItemTags = (itemName) => {
  if (!mcData) return []
  const item = mcData.itemsByName?.[itemName]
  if (!item) return []
  return Array.from(itemTagsById.get(item.id) ?? [])
}

const findChestsNearFrame = (frame) => {
  const base = frame.position.floored()
  const radius = config.chestSearchRadius
  const found = []

  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        const pos = base.offset(dx, dy, dz)
        const block = bot.blockAt(pos)
        if (block && chestBlockNames.has(block.name)) {
          found.push(block)
        }
      }
    }
  }

  return found
}

const scanSortTargets = () => {
  const targets = new Map()
  const categoryTargets = new Map()
  const frames = Object.values(bot.entities).filter((entity) =>
    entity.name === 'item_frame' || entity.name === 'glow_item_frame'
  )

  const keyForPos = (pos) => `${pos.x},${pos.y},${pos.z}`
  const mergeTargets = (targetMap, positions) => {
    const existing = targetMap ?? new Map()
    for (const [key, pos] of positions) {
      existing.set(key, pos)
    }
    return existing
  }

  for (const frame of frames) {
    if (frame.position.distanceTo(bot.entity.position) > config.sortRadius) continue
    const item = getItemFrameItem(frame)
    if (!item) continue
    const chests = findChestsNearFrame(frame)
    if (!chests.length) continue
    const positions = targets.get(item.name) ?? new Map()
    for (const chest of chests) {
      const pos = chest.position.clone()
      positions.set(keyForPos(pos), pos)
    }
    targets.set(item.name, positions)
    const tags = getItemTags(item.name)
    for (const tag of tags) {
      const merged = mergeTargets(categoryTargets.get(tag), positions)
      categoryTargets.set(tag, merged)
    }
  }

  return { targets, categoryTargets }
}

const ensureTargets = () => {
  const now = Date.now()
  if (now - lastScan > config.scanInterval * 1000 || targetsCache.size === 0) {
    const { targets, categoryTargets } = scanSortTargets()
    targetsCache = targets
    categoryTargetsCache = categoryTargets
    lastScan = now
    const totalChests = Array.from(targetsCache.values()).reduce(
      (sum, entries) => sum + entries.size,
      0
    )
    const totalCategoryChests = Array.from(categoryTargetsCache.values()).reduce(
      (sum, entries) => sum + entries.size,
      0
    )
    logInfo(
      `Scan complete. Found ${targetsCache.size} item target(s) across ${totalChests} chest(s).`
    )
    if (categoryTargetsCache.size > 0) {
      logInfo(
        `Category targets active: ${categoryTargetsCache.size} category(ies) across ${totalCategoryChests} chest(s).`
      )
    }
  }
  return { targets: targetsCache, categories: categoryTargetsCache }
}

const moveNear = async (position) => {
  const goal = new GoalNear(position.x, position.y, position.z, 1)
  await bot.pathfinder.goto(goal)
}

const depositIntoChest = async (chestPos, itemName) => {
  const block = bot.blockAt(new Vec3(chestPos.x, chestPos.y, chestPos.z))
  if (!block) return false

  await moveNear(chestPos)
  const chest = await bot.openChest(block)
  let deposited = false

  try {
    const items = bot.inventory.items().filter((item) => item.name === itemName)
    for (const item of items) {
      await chest.deposit(item.type, null, item.count)
      deposited = true
    }
  } finally {
    chest.close()
  }

  return deposited
}

const depositIntoTargets = async (targets, itemName) => {
  if (!targets || targets.size === 0) return false

  for (const chestPos of targets.values()) {
    try {
      const deposited = await depositIntoChest(chestPos, itemName)
      if (deposited) return true
    } catch (error) {
      logError(`Deposit failed for ${itemName}.`, error)
    }
  }

  return false
}

const sortInventory = async () => {
  if (sorting) return
  sorting = true

  try {
    const items = bot.inventory.items()
    const { targets, categories } = ensureTargets()
    if (items.length === 0 || (targets.size === 0 && categories.size === 0)) return
    for (const item of items) {
      let chestTargets = targets.get(item.name)
      if (!chestTargets) {
        const tags = getItemTags(item.name)
        for (const tag of tags) {
          chestTargets = categories.get(tag)
          if (chestTargets) break
        }
      }
      if (!chestTargets) continue
      await depositIntoTargets(chestTargets, item.name)
    }
  } catch (error) {
    logError('Sorting error:', error)
  } finally {
    sorting = false
  }
}

bot.once('spawn', () => {
  mcData = minecraftData(bot.version)
  const movements = new Movements(bot, mcData)
  bot.pathfinder.setMovements(movements)
  itemTagsById = new Map()
  const tagEntries = mcData.tags?.items ?? {}
  for (const [tagName, entries] of Object.entries(tagEntries)) {
    for (const entry of entries) {
      const set = itemTagsById.get(entry) ?? new Set()
      set.add(tagName)
      itemTagsById.set(entry, set)
    }
  }

  logInfo(`Connected as ${bot.username}`)

  intervalHandle = setInterval(() => {
    if (!sorting) sortInventory()
  }, config.sortInterval * 1000)
})

bot.on('end', () => {
  logInfo('Disconnected from server')
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
})

bot.on('kicked', (reason) => {
  logInfo(`Kicked from server: ${reason}`)
})

bot.on('error', (error) => {
  logError('Bot error:', error)
})
