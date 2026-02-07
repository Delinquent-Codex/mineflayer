# Mineflayer Sorter Bot

A Mineflayer bot that sorts items into multiple chests using item frames as targets.

## Prerequisites

- Node.js 20+ (recommended for current LTS releases)
- A running Minecraft server (online or local)

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

   This project uses caret (`^`) versions so `npm install` pulls the latest compatible releases available in your environment.

2. Copy the example environment file and edit values:

   ```bash
   cp .env.example .env
   ```

3. Start the bot:

   ```bash
   npm start
   ```

## How sorting works

1. Place a chest (or trapped chest).
2. Place an item frame on or adjacent to the chest.
3. Put the item you want sorted into that frame.
4. The bot will scan nearby frames and deposit matching items into the associated chest.

The bot uses any chest found near the item frame as a sorting target. You can place multiple item frames on the same chest (for multi-item storage) and multiple chests can share the same item frame target.

The sorter runs automatically on a fixed interval. It rescans item frames periodically to keep targets in sync when you move or change frames.

### Category sorting (tags)

If you place any item in a frame, the bot also treats that chest as a category target for every item tag that the frame item belongs to (using Minecraft tag data). This means a chest marked with a tagged item like `oak_log` can collect any item that shares the same tag (for example, other logs), while still allowing explicit item-to-chest mappings.

## Configuration

All settings are configured via environment variables:

- `MC_HOST` (default: `localhost`)
- `MC_PORT` (default: `25565`)
- `MC_USERNAME` (default: `MineflayerBot`)
- `MC_VERSION` (optional, e.g. `1.20.4`)
- `MC_AUTH` (optional, `mojang` or `microsoft`)
- `SORT_RADIUS` (default: `16`, max distance to search for item frames)
- `SORT_INTERVAL` (default: `30`, seconds between automatic sorts)
- `SORT_SCAN_INTERVAL` (default: `30`, seconds between rescanning item frames)
- `CHEST_SEARCH_RADIUS` (default: `1`, max blocks from frame to search for chests)

## Tips

- Keep the bot within the sorting area so pathfinding can reach every chest.
- Ensure the bot has inventory space and is close enough to item frames for scanning.
- If you move item frames or add new chests, wait for the scan interval to refresh targets.
