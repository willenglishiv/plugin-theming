import { PluginContext } from '@rcv-prod-toolkit/types'
import { join } from 'path'
import { writeFile, opendir, readFile, stat } from 'fs/promises'
import { emptyDir, copy } from 'fs-extra'
import { compileAsync } from 'sass'

interface ThemeConfig {
  name: string
  author: string
  version: string
}

interface Theme {
  config: ThemeConfig
  folder: string
  scss: string
  id: string
}

let themes: Theme[]

const getThemes = async (ctx: PluginContext): Promise<Theme[]> => {
  const themesPath = join(__dirname, '../themes')

  const themes: Theme[] = []

  const dir = await opendir(themesPath)
  for await (const folder of dir) {
    if (!folder.isDirectory()) continue

    const themePath = join(themesPath, folder.name)

    let themeConfig: ThemeConfig
    let scss: string
    try {
      themeConfig = require(join(themePath, 'theme.json'))
      scss = await readFile(join(themePath, 'index.scss'), 'utf-8')
    } catch (e) {
      ctx.log.warn(`Failed to load theme in ${themePath}`, e)
      continue
    }

    const theme: Theme = {
      config: themeConfig,
      folder: themePath,
      scss,
      id: folder.name
    }
    themes.push(theme)
  }

  return themes
}

/**
 * Returns the currently active theme, by reading the 'id' file on the file system,
 * or null if there currently is no theme active
 */
const getActiveTheme = async (): Promise<string | null> => {
  const idFilePath = join(__dirname, '../frontend/active/id')

  try {
    await stat(idFilePath)
  } catch (e) {
    return null
  }

  const activeTheme = (await readFile(idFilePath, 'utf-8')).trim()
  return activeTheme
}

module.exports = async (ctx: PluginContext) => {
  const namespace = ctx.plugin.module.getName()
  // Register new UI page
  ctx.LPTE.emit({
    meta: {
      type: 'add-pages',
      namespace: 'ui',
      version: 1
    },
    pages: [
      {
        name: 'Theming',
        frontend: 'frontend',
        id: `op-${namespace}`
      }
    ]
  })

  let activeTheme = await getActiveTheme()

  // Emit event that we're ready to operate
  ctx.LPTE.emit({
    meta: {
      type: 'plugin-status-change',
      namespace: 'lpt',
      version: 1
    },
    status: 'RUNNING'
  })

  themes = await getThemes(ctx)

  ctx.LPTE.on(namespace, 'get-themes', (event) => {
    ctx.LPTE.emit({
      meta: {
        type: event.meta.reply as string,
        namespace: 'reply',
        version: 1
      },
      themes,
      activeTheme
    })
  })

  ctx.LPTE.on(namespace, 'reload-themes', async (event) => {
    themes = await getThemes(ctx)
    ctx.LPTE.emit({
      meta: {
        type: event.meta.reply as string,
        namespace: 'reply',
        version: 1
      },
      themes,
      activeTheme
    })
  })

  ctx.LPTE.on(namespace, 'activate-theme', async (event) => {
    activeTheme = event.theme as string

    const themePath = join(__dirname, '../themes/', activeTheme)
    const activePath = join(__dirname, '../frontend/active')
    const idFilePath = join(activePath, 'id')
    const gitKeepFilePath = join(activePath, '.gitkeep')

    try {
      await emptyDir(activePath)
      await copy(themePath, activePath)

      await writeFile(idFilePath, activeTheme)
      await writeFile(gitKeepFilePath, '')
    } catch (e) {
      ctx.log.error('Applying theme failed', e)
    }

    try {
      const result = await compileAsync(join(activePath, 'index.scss'))
      await writeFile(join(activePath, 'index.css'), result.css)
    } catch (error) {
      ctx.log.error('Failed to compile scss', error)
    }

    ctx.LPTE.emit({
      meta: {
        type: event.meta.reply as string,
        namespace: 'reply',
        version: 1
      },
      themes,
      activeTheme
    })
  })
}
