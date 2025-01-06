import { MenuConfs, SettingsState, SubPanelType, CustomStyles } from 'src/types'
import { Google, Logs, Sync, Utils } from './_services'
import { Settings } from './settings'
import { Sidebar } from './sidebar'

export * as Firefox from './sync.firefox'
export * as Google from './sync.google'

export const enum SyncedEntryType {
  Settings = 1,
  CtxMenu = 2,
  Styles = 3,
  Keybindings = 4,
  Tabs = 5,
}

export type SyncedDataType<T> = T extends SyncedEntryType.Settings
  ? SettingsState
  : T extends SyncedEntryType.CtxMenu
    ? MenuConfs
    : T extends SyncedEntryType.Keybindings
      ? Record<string, string>
      : T extends SyncedEntryType.Styles
        ? CustomStyles
        : any

export interface EntryTab {
  id: ID
  title: string
  url: string
  lvl: number
  favicon?: string
  pin?: boolean
  parentId?: ID
  isParent?: boolean
  folded?: boolean
  containerId?: string
  containerColor?: string
  customTitle?: string
  customColor?: string
}

export interface EntryContainer {
  id: string
  name: string
  color: string
  icon: string
}

export interface SyncedEntry {
  id?: string
  type?: SyncedEntryType
  profileId?: string
  profileName?: string
  time?: number
  dateYYYYMMDD?: string
  timeHHMM?: string
  size?: string
  sameProfile?: boolean
  loading?: boolean

  tabs?: EntryTab[]
  containers?: Record<string, EntryContainer>

  gdFileId?: string
  ffKey?: string
}

export interface SyncReactiveState {
  loading: boolean
  syncing: boolean
  entries: SyncedEntry[]
}

export let ready = false
export const state = {
  subPanelScrollEl: null as HTMLElement | null,
  panelScrollEl: null as HTMLElement | null,
}
export let reactive: SyncReactiveState = {
  loading: false,
  syncing: false,
  entries: [],
}
export const q = new Utils.AsyncQueue()

let reactFn: (<T extends object>(rObj: T) => T) | undefined
export function initSync(react: (rObj: object) => object) {
  reactFn = react as <T extends object>(rObj: T) => T
  reactive = reactFn(reactive)
}

export function getProfileId() {
  return browser.runtime.getURL('').slice(16, 52)
}

export function getSyncedType(syncedTypeString: string): Sync.SyncedEntryType | null {
  switch (syncedTypeString) {
    case 'settings':
      return Sync.SyncedEntryType.Settings
    case 'ctxMenu':
    case 'ctx-menu':
      return Sync.SyncedEntryType.CtxMenu
    case 'styles':
      return Sync.SyncedEntryType.Styles
    case 'kb':
    case 'keybindings':
      return Sync.SyncedEntryType.Keybindings
    case 'tabs':
      return Sync.SyncedEntryType.Tabs
    default:
      return null
  }
}

export async function save<T extends SyncedEntryType>(type: T, data: SyncedDataType<T>) {
  Logs.info('Sync.save()')
  const entryId = Utils.uid()

  reactive.syncing = true

  try {
    if (type === Sync.SyncedEntryType.Settings) {
      if (Settings.state.syncUseFirefox) {
        await Sync.Firefox.save('settings', { settings: data }, entryId)
      }
      if (Settings.state.syncUseGoogleDrive) {
        await Sync.Google.save(Sync.Google.FileType.Settings, data, { entryId })
      }
    } else if (type === Sync.SyncedEntryType.CtxMenu) {
      if (Settings.state.syncUseFirefox) {
        await Sync.Firefox.save('ctxMenu', { contextMenu: data }, entryId)
      }
      if (Settings.state.syncUseGoogleDrive) {
        await Sync.Google.save(Sync.Google.FileType.CtxMenu, data, { entryId })
      }
    } else if (type === Sync.SyncedEntryType.Styles) {
      if (Settings.state.syncUseFirefox) {
        await Sync.Firefox.save('styles', data, entryId)
      }
      if (Settings.state.syncUseGoogleDrive) {
        await Sync.Google.save(Sync.Google.FileType.Styles, data, { entryId })
      }
    } else if (type === Sync.SyncedEntryType.Keybindings) {
      if (Settings.state.syncUseFirefox) {
        await Sync.Firefox.save('kb', data, entryId)
      }
      if (Settings.state.syncUseGoogleDrive) {
        await Sync.Google.save(Sync.Google.FileType.Keybindings, data, { entryId })
      }
    }
  } catch (err) {
    Logs.err('Sync.save()', err)
    // TODO: show notification about this
  }

  reactive.syncing = false
}

export async function remove(entry: SyncedEntry) {
  Logs.info('Sync.remove():', entry)

  reactive.syncing = true
  // TODO: undo

  let removingInFirefoxSync
  if (Settings.state.syncUseFirefox && entry.ffKey) {
    removingInFirefoxSync = browser.storage.sync.remove(entry.ffKey)
  }

  let removingInGoogleDrive
  if (Settings.state.syncUseGoogleDrive && entry.gdFileId) {
    if (entry.type === SyncedEntryType.Tabs) {
      removingInGoogleDrive = Sync.Google.removeTabsEntry(entry)
    } else {
      removingInGoogleDrive = Google.Drive.deleteFile(entry.gdFileId)
    }
  }

  try {
    await Promise.allSettled([removingInFirefoxSync, removingInGoogleDrive])
  } catch (err) {
    Logs.info('Sync.remove()', err)
    // TODO: show notification about this
    reactive.syncing = false
    return
  }

  const rmIndex = reactive.entries.findIndex(e => e.id === entry.id)
  if (rmIndex !== -1) reactive.entries.splice(rmIndex, 1)

  reactive.syncing = false
}

export async function getData<T>(entry: SyncedEntry): Promise<T | null | void> {
  Logs.info('Sync.getData(): entry:', entry)

  if (!entry.id) {
    Logs.err('Sync.getData(): No entry.id', entry)
    return
  }

  let data: T | undefined | null

  // Check in cached value from Firefox Sync
  const cachedFFValue = Sync.Firefox.cachedValues.get(entry.id)
  if (cachedFFValue?.value) {
    const val = cachedFFValue.value
    if (entry.type === SyncedEntryType.Settings) data = val.settings as T
    if (entry.type === SyncedEntryType.CtxMenu) data = val.contextMenu as T
    if (entry.type === SyncedEntryType.Keybindings) data = val.keybindings as T
    if (entry.type === SyncedEntryType.Styles) {
      data = { sidebarCSS: val.sidebarCSS, groupCSS: val.groupCSS } as T
    }
  }

  // Or try to download from Google Drive
  if (!data && entry.gdFileId) {
    data = await Google.Drive.getJsonFile(entry.gdFileId)
  }

  return data
}

export async function load() {
  Logs.info('Sync.load()')

  ready = false
  reactive.loading = true

  let entries: SyncedEntry[] = []

  // Get Firefox Sync data
  const [ffEntriesResult, gdEntriesResult] = await Promise.allSettled([
    Settings.state.syncUseFirefox ? Sync.Firefox.loadSyncedEntries() : [],
    Settings.state.syncUseGoogleDrive ? Sync.Google.loadSyncedEntries() : [],
  ])
  const ffEntries = Utils.settledOr(ffEntriesResult, [])
  const gdEntries = Utils.settledOr(gdEntriesResult, [])

  entries.push(...ffEntries)
  entries.push(...gdEntries)

  // Sort by time
  entries.sort((a, b) => (b.time ?? 0) - (a.time ?? 0))

  // Merge same entries
  const entryIds: Set<string> = new Set()
  entries = entries.filter(e => {
    if (!e.id) return true

    // Set corresponding google drive file id
    if (!e.gdFileId) {
      const gdEntry = gdEntries.find(gde => gde.id === e.id)
      if (gdEntry?.gdFileId) e.gdFileId = gdEntry.gdFileId
    }

    // Set corresponding firefox sync key
    if (!e.ffKey) {
      const ffEntry = ffEntries.find(ffe => ffe.id === e.id)
      if (ffEntry?.ffKey) e.ffKey = ffEntry.ffKey
    }

    if (!entryIds.has(e.id)) {
      entryIds.add(e.id)
      return true
    }
  })

  ready = true
  reactive.loading = false
  reactive.entries = entries

  const syncPanel = Sidebar.panelsById.sync
  if (syncPanel) syncPanel.reactive.ready = syncPanel.ready = true

  Logs.info('Sync.load(): Loaded:', entries)
}

export function unload() {
  Logs.info('Sync.unload()')

  Sync.Firefox.cachedValues.clear()
  Sync.Google.cachedTabFilesData.clear()

  reactive.entries = []
  reactive.syncing = false
  reactive.loading = false

  ready = false

  const syncPanel = Sidebar.panelsById.sync
  if (syncPanel) syncPanel.reactive.ready = syncPanel.ready = false
}

export async function reload() {
  if (reactive.loading || reactive.syncing) return
  unload()
  reactive.syncing = true
  try {
    await load()
  } catch (err) {
    Logs.err('Sync.reload', err)
    // TODO: Show notification about this shit
  }
  reactive.syncing = false
}

let unloadAfterTimeout: number | undefined
export function unloadAfter(delay: number) {
  Logs.info('Sync.unloadAfter(): delay:', delay)
  clearTimeout(unloadAfterTimeout)
  unloadAfterTimeout = setTimeout(() => {
    const syncPanel = Sidebar.panelsById.sync
    if (syncPanel && Sidebar.activePanelId === syncPanel.id) return
    if (syncPanel && !syncPanel.ready) return
    if (Sidebar.subPanelActive && Sidebar.subPanelType === SubPanelType.Sync) return

    unload()
  }, delay)
}

export function resetUnloadTimeout() {
  clearTimeout(unloadAfterTimeout)
}

///
/// Temp: Try to open window with sync-panel
///
export async function openSyncWindow() {
  Logs.info('Sync.openSyncWindow()')

  const width = 300
  const height = 600

  const syncWindow = await browser.windows.create({
    allowScriptsToClose: true,
    focused: true,
    width,
    height,
    incognito: false,
    state: 'normal',
    type: 'popup',
    url: '/popup.sync/sync.html',
    // For userChrome modificatoins with `#main-window[titlepreface='Sync‎']`
    titlePreface: 'Sync‎',
  })

  Logs.info('Sync.openSyncWindow():', syncWindow)
}

export async function saveTabs(
  tabsBatch: Sync.Google.SyncedTabsBatch,
  favicons: Record<string, string>
) {
  Logs.info('Sync.saveTabs(): tabsBatch:', tabsBatch)

  if (!tabsBatch.tabs.length) return

  reactive.syncing = true

  // Load sync service
  if (!Sync.ready) await Sync.load()
  else Sync.resetUnloadTimeout()

  try {
    if (Settings.state.syncUseGoogleDrive) {
      const tabsEntry = await Sync.Google.saveTabs(tabsBatch, favicons)
      reactive.entries.splice(0, 0, tabsEntry)
    }
  } catch (err) {
    Logs.info('Sync.saveTabs()', err)
    // TODO: Show notification about this error
  }

  reactive.syncing = false
}
