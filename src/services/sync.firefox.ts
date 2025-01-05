import { ContextMenuConfig_v4, CssVars, MenuConfs, SettingsState } from 'src/types'
import { Settings } from './settings'
import { Logs, Sync, Utils } from './_services'
import { Info } from './info'
import { DEFAULT_SETTINGS } from 'src/defaults'
import { Styles } from './styles'
import { Store } from './storage'
import { Menu } from './menu'
import { Keybindings } from './keybindings'
import { SyncedEntry } from './sync'

type KeyType = 'settings' | 'ctxMenu' | 'kb' | 'styles'

/**
 * Key value pairs stored to browser.storage.sync.
 *
 * key is `${profileId}::${dataType}`
 * where dataType is 'settings' | 'ctxMenu' | 'styles' | 'kb'
 */
export interface Synced {
  [key: string]: SyncedValue
}

/**
 * Sync value object
 */
export interface SyncedValue {
  ver?: string // Addon version
  name: string // Profile name
  time: number // Modification time
  value: SyncableData
  entryId?: string
}

/**
 * Collection of data that can be synced via Firefox Sync
 */
export interface SyncableData {
  settings?: SettingsState
  contextMenu?: MenuConfs
  sidebarCSS?: string
  groupCSS?: string
  keybindings?: { [name: string]: string }

  tabsMenu?: ContextMenuConfig_v4 // DEPR
  bookmarksMenu?: ContextMenuConfig_v4 // DEPR
  tabsPanelMenu?: ContextMenuConfig_v4 // DEPR
  bookmarksPanelMenu?: ContextMenuConfig_v4 // DEPR
  cssVars?: CssVars // DEPR
}

export function syncEntryTypeToKeyType(entryType: Sync.SyncedEntryType): KeyType | void {
  switch (entryType) {
    case Sync.SyncedEntryType.Settings:
      return 'settings'
    case Sync.SyncedEntryType.CtxMenu:
      return 'ctxMenu'
    case Sync.SyncedEntryType.Styles:
      return 'styles'
    case Sync.SyncedEntryType.Keybindings:
      return 'kb'
  }
}

export async function save(key: KeyType, value: SyncableData, entryId?: string) {
  const keys = Object.keys(value)

  if (keys.length) {
    const profileId = await Info.getProfileId()
    const syncPropName = profileId + '::' + key
    const time = Date.now()
    const ver = Info.reactive.addonVer
    await browser.storage.sync.set<Synced>({
      [syncPropName]: { value, time, name: Settings.state.syncName, ver, entryId },
    })
  }
}

export async function remove(keyType: KeyType) {
  Logs.info('Sync.Firefox.remove():', keyType)

  const profileId = await Info.getProfileId()
  const key = profileId + '::' + keyType

  await browser.storage.sync.remove(key)
}

export async function updateProfileInfo() {
  Logs.info('Sync.Firefox.updateProfileInfo()')

  const [synced, legacyProfileId] = await Promise.all([
    browser.storage.sync.get<Synced>(),
    Info.getProfileId(),
  ])
  const profileId = Sync.getProfileId()

  if (!synced || !legacyProfileId) return

  for (const syncedKey of Object.keys(synced)) {
    const syncedValue = synced[syncedKey] as SyncedValue
    const [syncedProfileId, syncedTypeStr] = syncedKey.split('::')

    // Check data integrity
    if (!syncedValue || !syncedProfileId || !syncedTypeStr) {
      continue
    }

    // Update profile name
    if (syncedProfileId === profileId || syncedProfileId === legacyProfileId) {
      Logs.info(
        'Sync.Firefox.updateProfileInfo(): name:',
        syncedValue.name,
        '>>',
        Settings.state.syncName,
        'for',
        syncedTypeStr
      )
      syncedValue.name = Settings.state.syncName
    }
  }

  // Save updated data
  await browser.storage.sync.set<Synced>(synced)
}

export const cachedValues: Map<string, SyncedValue> = new Map()

export async function loadSyncedEntries(): Promise<SyncedEntry[]> {
  Logs.info('Sync.Firefox.loadSyncedEntries()')

  const entries: SyncedEntry[] = []
  const [synced, legacyProfileId] = await Promise.all([
    browser.storage.sync.get<Synced>(),
    Info.getProfileId(),
  ])
  const profileId = Sync.getProfileId()

  if (!synced || !legacyProfileId) return entries

  const toRemove = []
  const dayStartTime = Utils.getDayStartMS()

  for (const syncedKey of Object.keys(synced)) {
    const syncedValue = synced[syncedKey] as SyncedValue
    const [syncedProfileId, syncedTypeStr] = syncedKey.split('::')

    // Check data integrity
    if (!syncedValue || !syncedProfileId || !syncedTypeStr) {
      toRemove.push(syncedKey)
      continue
    }

    const syncType = Sync.getSyncedType(syncedTypeStr)
    // Skip non-sync file types
    if (!syncType) {
      continue
    }

    let dateYYYYMMDD = '???'
    let timeHHMM = '???'
    if (syncedValue.time) {
      const td = new Date(syncedValue.time)
      dateYYYYMMDD = Utils.dDate(td, '.', dayStartTime)
      timeHHMM = Utils.dTime(td, ':', false)
    }

    const syncedEntry: Sync.SyncedEntry = {
      id: syncedValue.entryId || syncedKey,
      type: syncType,
      profileId: syncedProfileId,
      profileName: syncedValue.name || syncedProfileId,
      time: syncedValue.time,
      dateYYYYMMDD,
      timeHHMM,
      size: Utils.strSize(JSON.stringify(syncedValue)),
      sameProfile: syncedProfileId === legacyProfileId || syncedProfileId === profileId,

      ffKey: syncedKey,
    }
    cachedValues.set(syncedValue.entryId || syncedKey, syncedValue)

    entries.push(syncedEntry)
  }

  // Remove incorrect data
  if (toRemove.length) {
    browser.storage.sync.remove(toRemove)
  }

  // Sort
  entries.sort((a, b) => (b.time ?? 0) - (a.time ?? 0))

  return entries
}

/**
 * Update local storage with synced data and reload that data
 */
export async function applySyncData(info: SyncedValue) {
  const syncMajorVer = Info.getMajVer(info.ver)
  const currentMajorVer = Info.majorVersion
  let data = Utils.cloneObject(info.value)

  // Upgrade data
  if (!syncMajorVer || syncMajorVer !== currentMajorVer) {
    const old = data
    data = {}

    // Upgrade settings
    if (old.settings) {
      try {
        data.settings = Utils.recreateNormalizedObject(old.settings, DEFAULT_SETTINGS)
        data.settings.theme = 'proton'
        if (data.settings.tabDoubleClick !== 'none') {
          data.settings.tabsSecondClickActPrev = false
        }
        if (old.settings.hScrollThroughPanels === true) {
          data.settings.hScrollAction = 'switch_panels'
        } else if (old.settings.hScrollThroughPanels === false) {
          data.settings.hScrollAction = 'none'
        }
        if ((old.settings.moveNewTabPin as string) === 'none') {
          data.settings.moveNewTabPin = 'start'
        }
      } catch (err) {
        Logs.err('Cannot upgrade legacy settings', err)
        throw 'settings'
      }
    }

    // Upgrade styles
    if (old.sidebarCSS || old.groupCSS || old.cssVars) {
      try {
        Styles.upgradeCustomStyles(old, data)
      } catch (err) {
        Logs.err('Cannot upgrade legacy styles', err)
        throw 'styles'
      }
    }
  }

  // Update settings
  if (data.settings) {
    // Keep sync settings
    data.settings.syncName = Settings.state.syncName
    data.settings.syncSaveSettings = Settings.state.syncSaveSettings
    data.settings.syncSaveCtxMenu = Settings.state.syncSaveCtxMenu
    data.settings.syncSaveStyles = Settings.state.syncSaveStyles
    data.settings.syncSaveKeybindings = Settings.state.syncSaveKeybindings

    await Store.set({ settings: data.settings })
    Settings.loadSettings()
  }

  // Update context menu
  if (data.contextMenu) {
    await Store.set({ contextMenu: data.contextMenu })
    Menu.loadCtxMenu()
  }

  // Update styles
  if (data.sidebarCSS || data.groupCSS) {
    await Store.set({
      sidebarCSS: data.sidebarCSS,
      groupCSS: data.groupCSS,
    })
  }

  // Update keybindings
  if (data.keybindings) {
    const waiting = []
    for (const name of Object.keys(data.keybindings)) {
      const shortcut = data.keybindings[name]
      if (!name || !shortcut) continue

      const toRm = Keybindings.reactive.list.find(c => c.shortcut === shortcut)
      if (toRm?.name) waiting.push(browser.commands.update({ name: toRm.name, shortcut: '' }))

      waiting.push(browser.commands.update({ name, shortcut }))
    }

    await Promise.allSettled(waiting)
    Keybindings.loadKeybindings()
  }
}
