import { Stored, TabReopenRuleConfig } from 'src/types'
import { Google, Logs, Sync, Utils } from './_services'
import { Settings } from './settings'
import { Store } from './storage'
import { SyncedEntry } from './sync'
import { Favicons } from './_services.fg'
import { NOID } from 'src/defaults'
import { Notifications } from './notifications'
import { translate } from 'src/dict'

export interface ProfileInfo {
  name: string
  icon: string
  color: string
}

export const enum FileType {
  ProfileInfo = 1,
  Settings = 2,
  CtxMenu = 3,
  Styles = 4,
  Keybindings = 5,
  Tabs = 6,
}

export interface SyncedContainer {
  id: string
  name: string
  icon: string
  color: string
  proxified: boolean
  proxy: browser.proxy.ProxyInfo | null
  reopenRulesActive: boolean
  reopenRules: TabReopenRuleConfig[]
  userAgentActive: boolean
  userAgent: string
}

export interface SyncedTab {
  id: ID
  title: string
  url: string
  domain?: string
  pin?: boolean
  parentId?: ID
  folded?: boolean
  containerId?: string
  customTitle?: string
  customColor?: string
}

export interface SyncedTabsBatch {
  id: string
  time: number
  profileId: string
  tabs: SyncedTab[]
  containers: Record<string, SyncedContainer>
}

export interface SyncedTabsFileData {
  batches: SyncedTabsBatch[]
  favicons: Record<string, string>
}

export const typeNames: Record<(typeof FileType)[keyof typeof FileType], string> = {
  [FileType.ProfileInfo]: 'profile-info',
  [FileType.Settings]: 'settings',
  [FileType.CtxMenu]: 'ctx-menu',
  [FileType.Styles]: 'styles',
  [FileType.Keybindings]: 'keybindings',
  [FileType.Tabs]: 'tabs',
}

/**
 * Synced tab files content by fileId
 */
export const cachedTabFilesData: Map<string, SyncedTabsFileData> = new Map()

const QUEUE = new Utils.AsyncQueue()

export function getFileName(fileType: FileType): string {
  const profileId = Sync.getProfileId()

  switch (fileType) {
    case FileType.ProfileInfo:
      return `${typeNames[FileType.ProfileInfo]}_${profileId}.json`
    case FileType.Settings:
      return `${typeNames[FileType.Settings]}_${profileId}.json`
    case FileType.CtxMenu:
      return `${typeNames[FileType.CtxMenu]}_${profileId}.json`
    case FileType.Styles:
      return `${typeNames[FileType.Styles]}_${profileId}.json`
    case FileType.Keybindings:
      return `${typeNames[FileType.Keybindings]}_${profileId}.json`
    case FileType.Tabs:
      return `${typeNames[FileType.Tabs]}_${profileId}.json`
  }
}

export function syncEntryTypeToFileType(entryType: Sync.SyncedEntryType): FileType | void {
  switch (entryType) {
    case Sync.SyncedEntryType.Settings:
      return FileType.Settings
    case Sync.SyncedEntryType.CtxMenu:
      return FileType.CtxMenu
    case Sync.SyncedEntryType.Styles:
      return FileType.Styles
    case Sync.SyncedEntryType.Keybindings:
      return FileType.Keybindings
    case Sync.SyncedEntryType.Tabs:
      return FileType.Tabs
  }
}

let cachedFileIds: Map<FileType, string | null> | null = null

async function loadCachedFileIds() {
  Logs.info('Sync.Google.loadCachedFileIds()')

  const stored = await browser.storage.local.get<Stored>('googleDriveFileIds')
  const storedIds = stored?.googleDriveFileIds ?? {}
  const cachedIds = new Map()
  cachedIds.set(FileType.ProfileInfo, storedIds[typeNames[FileType.ProfileInfo]] ?? null)
  cachedIds.set(FileType.Settings, storedIds[typeNames[FileType.Settings]] ?? null)
  cachedIds.set(FileType.CtxMenu, storedIds[typeNames[FileType.CtxMenu]] ?? null)
  cachedIds.set(FileType.Styles, storedIds[typeNames[FileType.Styles]] ?? null)
  cachedIds.set(FileType.Keybindings, storedIds[typeNames[FileType.Keybindings]] ?? null)

  Logs.info('Sync.Google.loadCachedFileIds(): Loaded:', cachedIds)

  return cachedIds
}

async function saveCachedFileIds() {
  Logs.info('Sync.Google.saveCachedFileIds():', cachedFileIds)

  if (!cachedFileIds) return Logs.err('Sync.Google.saveCachedFileIds(): Nothing to save')

  const storedIds: Record<string, string | null> = {}

  for (const [fileType, id] of cachedFileIds) {
    if (id !== undefined) storedIds[typeNames[fileType]] = id
  }

  Logs.info('Sync.Google.saveCachedFileIds(): storedIds:', storedIds)

  await Store.set({ googleDriveFileIds: storedIds })
}
const saveCachedFileIdsDebounced = Utils.debounce(saveCachedFileIds)

async function updateCachedFileIds() {
  Logs.info('Sync.Google.updateCachedFileIds()')

  // Get all files of this profile
  const profileId = Sync.getProfileId()
  const files = await Google.Drive.listFiles({
    fields: ['id'],
    q: `name contains '${Sync.getProfileId()}'`,
  })
  if (!files) return null

  cachedFileIds = new Map()

  let profileInfoId: string | undefined
  let settingsId: string | undefined
  let ctxMenuId: string | undefined
  let stylesId: string | undefined
  let keybindingsId: string | undefined

  for (const file of files) {
    const props = file.appProperties
    const fileProfileId = props?.profileId
    const fileType = props?.type
    if (fileProfileId !== profileId || !file.id) continue

    if (fileType === typeNames[FileType.ProfileInfo]) profileInfoId = file.id
    if (fileType === typeNames[FileType.Settings]) settingsId = file.id
    if (fileType === typeNames[FileType.CtxMenu]) ctxMenuId = file.id
    if (fileType === typeNames[FileType.Styles]) stylesId = file.id
    if (fileType === typeNames[FileType.Keybindings]) keybindingsId = file.id
  }

  cachedFileIds.set(FileType.ProfileInfo, profileInfoId ?? null)
  cachedFileIds.set(FileType.Settings, settingsId ?? null)
  cachedFileIds.set(FileType.CtxMenu, ctxMenuId ?? null)
  cachedFileIds.set(FileType.Styles, stylesId ?? null)
  cachedFileIds.set(FileType.Keybindings, keybindingsId ?? null)

  saveCachedFileIds()
}

/**
 * Create new file or update it
 */
export async function save<T>(
  type: FileType,
  content: T,
  props?: Record<string, string>,
  noRetry?: boolean
): Promise<Google.Drive.GDOutputFile | null | void> {
  Logs.info('Sync.Google.save():', typeNames[type])

  return QUEUE.add(async () => {
    // Load cached file ids if needed
    if (!cachedFileIds) {
      Logs.info('Sync.Google.save(): No cached file ids, loading...')
      cachedFileIds = new Map(await loadCachedFileIds())
    }

    const fileName = getFileName(type)
    const cachedId = cachedFileIds.get(type)
    let fileId: string | undefined

    // Cached id is found
    if (cachedId) {
      fileId = cachedId
    }

    // No cached id: Fetch list of files and update cached file ids
    // cachedId === null means the absence of file
    else if (cachedId === undefined) {
      Logs.info('Sync.Google.save(): No cached id: Upd cache')
      await updateCachedFileIds()
      fileId = cachedFileIds.get(type) ?? undefined
      Logs.info('Sync.Google.save(): Cache updated: Id:', fileId)
    }

    const addonVer = browser.runtime.getManifest().version
    const profileId = Sync.getProfileId()
    const appProps = { ver: addonVer, type: typeNames[type], profileId, ...props }

    // No file: Create new
    if (!fileId) {
      const newFile = await Google.Drive.createJsonFile({
        name: fileName,
        content,
        appProperties: appProps,
      })
      if (newFile?.id) {
        cachedFileIds.set(type, newFile.id)
        saveCachedFileIdsDebounced(200)
      } else {
        throw 'Cannot create new file'
      }
      return newFile
    }

    // Try to update existed file
    try {
      return await Google.Drive.updateJsonFile({ fileId, content, appProperties: appProps })
    } catch (err) {
      if (noRetry) {
        Logs.err('Sync.Google.save(): Cannot update file:', err)
        return
      }
      Logs.warn('Sync.Google.save(): Cannot update file, retrying...', err)

      // Reset cached id and try again
      cachedFileIds.set(type, null)
      saveCachedFileIds()

      return await save(type, content, props, true)
    }
  })
}

/**
 * Delete file (of the current profile)
 */
export async function remove(type: FileType) {
  Logs.info('Sync.Google.remove():', typeNames[type])

  return await QUEUE.add(async () => {
    // Load cached file ids if needed
    if (!cachedFileIds) cachedFileIds = new Map(await loadCachedFileIds())
    const fileId = cachedFileIds.get(type)

    // Remove file by cached id
    if (fileId) {
      try {
        await Google.Drive.deleteFile(fileId)
        cachedFileIds.set(type, null)
        saveCachedFileIds()
        return
      } catch (err) {
        Logs.warn('Sync.Google.remove(): Cannot remove file by cached id, removing by type...')
      }
    }

    const fileName = getFileName(type)
    const files = await Google.Drive.listFiles({ fields: ['id'], q: `name = '${fileName}'` })

    // No files: Nothing to do
    if (!files || !files.length) {
      cachedFileIds.set(type, null)
      saveCachedFileIds()
      return
    }

    for (const file of files) {
      if (file.id) {
        await Google.Drive.deleteFile(file.id)
      }
    }

    cachedFileIds.set(type, null)
    saveCachedFileIds()
  })
}

/**
 * Load info about other profiles
 */
export async function loadOtherProfilesInfo(): Promise<ProfileInfo[]> {
  Logs.info('Sync.Google.loadOtherProfilesInfo()')

  const typeName = typeNames[FileType.ProfileInfo]
  const fileNameOfCurrentProfile = getFileName(FileType.ProfileInfo)
  const filesInfo = await Google.Drive.listFiles({
    fields: ['id', 'appProperties'],
    q: `name contains '${typeName}' and name != '${fileNameOfCurrentProfile}'`,
  })

  if (!filesInfo || !filesInfo.length) return []

  const profiles: ProfileInfo[] = []
  for (const fileInfo of filesInfo) {
    if (!fileInfo.appProperties) continue

    profiles.push({
      name: fileInfo.appProperties.name,
      icon: fileInfo.appProperties.icon,
      color: fileInfo.appProperties.color,
    })
  }

  return profiles
}

export async function saveProfileInfo() {
  Logs.info('Sync.Google.saveProfileInfo()')

  const profileInfo: ProfileInfo = {
    name: Settings.state.syncName.trim(),
    icon: 'default',
    color: 'toolbar',
  }

  const props: Record<string, string> = {
    profileName: profileInfo.name,
    profileIcon: 'default',
    profileColor: 'toolbar',
  }
  await Sync.Google.save(FileType.ProfileInfo, profileInfo, props)
}

export async function removeAllFilesOfThisProfile() {
  Logs.info('Sync.Google.removeAllFilesOfThisProfile()')

  return await QUEUE.add(async () => {
    const filesInfo = await Google.Drive.listFiles({
      fields: ['id'],
      q: `name contains '${Sync.getProfileId()}'`,
    })

    // No files: Nothing to do
    if (!filesInfo || !filesInfo.length) {
      return
    }

    for (const file of filesInfo) {
      if (file.id) await Google.Drive.deleteFile(file.id)
    }

    cachedFileIds = new Map()
    saveCachedFileIds()
  })
}

export async function loadSyncedEntries(): Promise<SyncedEntry[] | null> {
  Logs.info('Sync.Google.loadSyncedEntries()')

  const entries: SyncedEntry[] = []
  const filesInfo = await Google.Drive.listFiles({
    fields: ['id', 'name', 'size', 'modifiedTime', 'appProperties'],
    orderBy: 'modifiedTime',
  })
  if (!filesInfo) {
    Logs.err('Sync.Google.loadSyncedEntries(): Cannot list files')
    return null
  }
  if (filesInfo.length === 0) {
    Logs.warn('Sync.Google.loadSyncedEntries(): No files')
    return entries
  }

  Logs.info('Sync.Google.loadSyncedEntries(): Files:', filesInfo)

  const profileId = Sync.getProfileId()
  const dayStartTime = Utils.getDayStartMS()

  // Get profile info
  const profiles: Record<string, ProfileInfo> = {}
  const profileFileType = typeNames[FileType.ProfileInfo]
  for (const fileInfo of filesInfo) {
    const props = fileInfo.appProperties
    if (props?.profileId && props?.type === profileFileType) {
      profiles[props.profileId] = {
        name: props.profileName,
        icon: props.profileIcon,
        color: props.profileColor,
      }
    }
  }

  const loadingTabEntries: Promise<SyncedEntry[] | void>[] = []

  for (const fileInfo of filesInfo) {
    const props = fileInfo.appProperties
    if (!fileInfo.id || !props || !props.profileId) {
      Logs.warn('Sync.Google.loadSyncedEntries(): Not enough data:', fileInfo)
      continue
    }

    const syncType = Sync.getSyncedType(props.type)
    // Skip non-sync file types
    if (!syncType) {
      Logs.info('Sync.Google.loadSyncedEntries(): Unknown type:', fileInfo)
      continue
    }

    const profileInfo = profiles[props.profileId]
    if (!profileInfo) {
      Logs.warn('Sync.Google.loadSyncedEntries(): Cannot find profile:', fileInfo, profiles)
      continue
    }

    // Load synced tabs
    if (syncType === Sync.SyncedEntryType.Tabs) {
      loadingTabEntries.push(loadSyncedTabEntries(fileInfo, profileInfo, dayStartTime, profileId))
      continue
    }

    const modTime = fileInfo.modifiedTime ? new Date(fileInfo.modifiedTime) : null
    const dateYYYYMMDD = modTime ? Utils.dDate(modTime, '.', dayStartTime) : '???'
    const timeHHMM = modTime ? Utils.dTime(modTime, ':', false) : '???'

    const syncedEntry: Sync.SyncedEntry = {
      id: props.entryId || fileInfo.id,
      type: syncType,
      profileId: props.profileId,
      profileName: profileInfo.name,
      time: modTime?.getTime(),
      dateYYYYMMDD,
      timeHHMM,
      size: fileInfo.size,
      sameProfile: props.profileId === profileId,

      gdFileId: fileInfo.id,
    }

    entries.push(syncedEntry)
  }

  if (loadingTabEntries.length) {
    let withError = false
    const loadedTabEntryFiles = await Promise.allSettled(loadingTabEntries)
    for (const tabEntriesResult of loadedTabEntryFiles) {
      const tabEntries = Utils.settledOr(tabEntriesResult, null)
      if (tabEntries) entries.push(...tabEntries)
      else withError = true
    }

    if (withError) {
      Notifications.notify({
        icon: '#icon_sync',
        lvl: 'err',
        title: translate('panel.sync.err.google_tabs'),
        details: translate('panel.sync.err.google_entries_sub'),
      })
    }
  }

  // TODO: Remove profile-info if there is no valid entries for it

  Logs.info('Sync.Google.loadSyncedEntries(): Result:', entries)

  return entries
}

async function loadSyncedTabEntries(
  fileInfo: Google.Drive.GDOutputFile,
  profileInfo: ProfileInfo,
  dayStartTime: number,
  currentProfileId: string
): Promise<SyncedEntry[] | void> {
  Logs.info('Sync.Google.loadSyncedTabEntries():', fileInfo)

  const props = fileInfo.appProperties
  if (!fileInfo.id || !fileInfo.modifiedTime || !props) {
    Logs.warn('Sync.Google.loadSyncedTabs(): Not enough data:', fileInfo)
    return
  }

  const data = await Google.Drive.getJsonFile<SyncedTabsFileData>(fileInfo.id)
  if (!data) {
    Logs.warn('Sync.Google.loadSyncedTabEntries(): Cannot load file:', fileInfo)
    return
  }

  Logs.info('Sync.Google.loadSyncedTabEntries(): Raw data:', data)

  if (props.profileId === currentProfileId) {
    cachedTabFilesData.set(fileInfo.id, data)
  }

  const favicons = data.favicons
  const entries: SyncedEntry[] = []

  for (const syncedTabsBatch of data.batches) {
    const modTime = new Date(syncedTabsBatch.time)
    const dateYYYYMMDD = modTime ? Utils.dDate(modTime, '.', dayStartTime) : '???'
    const timeHHMM = modTime ? Utils.dTime(modTime, ':', false) : '???'

    const containers: Record<string, Sync.EntryContainer> = syncedTabsBatch.containers
    const tabs = syncedTabsToEntryTabs(syncedTabsBatch, favicons)
    if (!tabs.length) continue

    entries.push({
      id: syncedTabsBatch.id || fileInfo.id,
      type: Sync.SyncedEntryType.Tabs,
      profileId: props.profileId,
      profileName: profileInfo.name,
      time: modTime?.getTime(),
      dateYYYYMMDD,
      timeHHMM,
      size: fileInfo.size,
      sameProfile: syncedTabsBatch.profileId === currentProfileId,

      tabs,
      containers,

      gdFileId: fileInfo.id,
    })
  }

  Logs.info('Sync.Google.loadSyncedTabEntries(): Entries:', entries)

  return entries
}

function syncedTabsToEntryTabs(tabsEntry: SyncedTabsBatch, favicons: Record<string, string>) {
  const tabsById: Record<ID, Sync.EntryTab> = {}
  const tabs: Sync.EntryTab[] = []

  for (let i = 0; i < tabsEntry.tabs.length; i++) {
    const tab = tabsEntry.tabs[i]
    const nextTab = tabsEntry.tabs[i + 1]
    const parentTab = tab.parentId !== undefined ? tabsById[tab.parentId] : undefined
    const container = tabsEntry.containers[tab.containerId ?? NOID]
    const eTab: Sync.EntryTab = {
      id: tab.id,
      title: tab.title,
      url: tab.url,
      lvl: parentTab ? parentTab.lvl + 1 : 0,
      pin: !!tab.pin,
      isParent: nextTab?.parentId === tab.id,
      parentId: tab.parentId,
      folded: !!tab.folded,
      containerId: tab.containerId,
      customTitle: tab.customTitle,
      customColor: tab.customColor,
    }

    if (tab.domain) eTab.favicon = favicons[tab.domain]
    if (!eTab.favicon) eTab.favicon = Favicons.getFavPlaceholder(tab.url)
    if (container) eTab.containerColor = container.color

    tabsById[eTab.id] = eTab
    tabs.push(eTab)
  }

  return tabs
}

const TABS_PER_FILE_LIMIT = 10
const TAB_FILES_MAX_COUNT = 3

export async function saveTabs(
  tabsBatch: Sync.Google.SyncedTabsBatch,
  favicons: Record<string, string>
): Promise<SyncedEntry> {
  Logs.info('Sync.Google.saveTabs():', tabsBatch)

  if (!Sync.ready) await Sync.load()

  const recentTabsEntry = Sync.reactive.entries.find(e => e.type === Sync.SyncedEntryType.Tabs)
  const oldestTabsEntry = Sync.reactive.entries.findLast(e => e.type === Sync.SyncedEntryType.Tabs)
  const recentFileId = recentTabsEntry?.gdFileId
  const oldestFileId = oldestTabsEntry?.gdFileId
  Logs.info('Sync.Google.saveTabs(): recentFileId:', recentFileId)

  let recentFileData = recentFileId ? cachedTabFilesData.get(recentFileId) : undefined
  let tabFilesCount = cachedTabFilesData.size
  let targetFileId

  const recentIsFromCache = !!recentFileData
  const addonVer = browser.runtime.getManifest().version
  const profileId = Sync.getProfileId()
  const appProps = { ver: addonVer, type: typeNames[FileType.Tabs], profileId }

  Logs.info('Sync.Google.saveTabs(): tabFilesCount:', tabFilesCount)
  Logs.info('Sync.Google.saveTabs(): recentFileData:', Utils.clone(recentFileData))

  // Add new tabs and favicons
  if (recentFileData) {
    Logs.info('Sync.Google.saveTabs(): Updating current file data...')
    recentFileData.batches.splice(0, 0, tabsBatch)
    Object.assign(recentFileData.favicons, favicons)
  } else {
    Logs.info('Sync.Google.saveTabs(): Creating new file data...')
    recentFileData = {
      batches: [tabsBatch],
      favicons,
    }
  }

  // Check the limits
  let newFileData: Sync.Google.SyncedTabsFileData | undefined
  let fileIdToRemove
  if (recentIsFromCache) {
    // Split the current cached file
    let tabCount = 0
    let splitIndex = 0
    const splitThreshold = TABS_PER_FILE_LIMIT / 2
    const batchLen = recentFileData.batches.length
    for (let i = batchLen; i-- > 0; ) {
      const sTabsBatch = recentFileData.batches[i]
      tabCount += sTabsBatch.tabs.length

      if (splitIndex === 0 && tabCount > splitThreshold) {
        splitIndex = i
      }

      if (tabCount > TABS_PER_FILE_LIMIT && splitIndex > 0) {
        Logs.info('Sync.Google.saveTabs(): Splitting file: splitIndex:', splitIndex)
        Logs.info('Sync.Google.saveTabs(): Splitting file...', Utils.clone(recentFileData))
        newFileData = halveTabBatches(recentFileData, splitIndex)
        tabFilesCount++
        break
      }
    }

    // Check the count of all synced-tab files and remove the oldest?
    if (tabFilesCount > TAB_FILES_MAX_COUNT && oldestFileId) {
      fileIdToRemove = oldestFileId
    }
  }

  // Update file
  if (recentFileId && recentIsFromCache) {
    // Remove empty batches
    recentFileData.batches = recentFileData.batches.filter(batch => {
      return !!batch.tabs.length
    })

    const fileId = recentFileId
    await Google.Drive.updateJsonFile({ fileId, content: recentFileData })

    if (!newFileData) targetFileId = fileId
  }

  // Create the first file
  else {
    Logs.info('Sync.Google.saveTabs(): Creating the first file...', Utils.clone(recentFileData))
    const createdFile = await Google.Drive.createJsonFile({
      name: Sync.Google.getFileName(FileType.Tabs),
      content: recentFileData,
      appProperties: appProps,
    })

    Logs.info('Sync.Google.saveTabs(): The first file:', createdFile)

    if (createdFile?.id) {
      targetFileId = createdFile.id
      cachedTabFilesData.set(createdFile.id, recentFileData)
    } else {
      Logs.err('Sync.Google.saveTabs(): New file: No id')
    }
  }

  // Create a new file separated from the overflowed one
  if (newFileData) {
    Logs.info('Sync.Google.saveTabs(): Creating a new separated file...', Utils.clone(newFileData))
    const createdFile = await Google.Drive.createJsonFile({
      name: Sync.Google.getFileName(FileType.Tabs),
      content: newFileData,
      appProperties: appProps,
    })
    Logs.info('Sync.Google.saveTabs(): The new file:', createdFile)

    if (createdFile?.id) {
      targetFileId = createdFile.id
      cachedTabFilesData.set(createdFile.id, newFileData)
    } else {
      Logs.err('Sync.Google.saveTabs(): New file: No id')
    }
  }

  // Remove the oldest file that exeeds the limit
  if (fileIdToRemove) {
    Logs.info('Sync.Google.saveTabs(): Removing the oldest file that exeeds the limit...')
    await Google.Drive.deleteFile(fileIdToRemove)
    cachedTabFilesData.delete(fileIdToRemove)
    // TODO: update reactive Sync state
  }

  // Return the new entry
  const entryTabs = syncedTabsToEntryTabs(tabsBatch, favicons)
  const entryTime = new Date(tabsBatch.time)
  const dayStartTime = Utils.getDayStartMS()
  const dateYYYYMMDD = entryTime ? Utils.dDate(entryTime, '.', dayStartTime) : '???'
  const timeHHMM = entryTime ? Utils.dTime(entryTime, ':', false) : '???'
  return {
    id: tabsBatch.id,
    type: Sync.SyncedEntryType.Tabs,
    profileId: Sync.getProfileId(),
    profileName: Settings.state.syncName.trim(),
    time: tabsBatch.time,
    dateYYYYMMDD,
    timeHHMM,
    size: '???',
    sameProfile: true,

    tabs: entryTabs,
    containers: Utils.cloneObject(tabsBatch.containers),

    gdFileId: targetFileId,
  }
}

/**
 * Split batches of tabs modifying the source. Returns the most recent part.
 */
function halveTabBatches(
  file: SyncedTabsFileData,
  splitIndex: number
): SyncedTabsFileData | undefined {
  const batchCount = file.batches.length
  if (splitIndex === 0) splitIndex = Math.trunc(batchCount / 2)
  if (splitIndex === 0) return

  const newBatches = file.batches.slice(0, splitIndex)
  const oldBatches = file.batches.slice(splitIndex)

  const newFavicons: Record<string, string> = {}
  const oldFavicons: Record<string, string> = {}

  for (const newBatch of newBatches) {
    for (const tab of newBatch.tabs) {
      if (!tab.domain) continue

      const favicon = file.favicons[tab.domain]
      if (favicon) newFavicons[tab.domain] = favicon
    }
  }

  for (const oldBatch of oldBatches) {
    for (const tab of oldBatch.tabs) {
      if (!tab.domain) continue

      const favicon = file.favicons[tab.domain]
      if (favicon) oldFavicons[tab.domain] = favicon
    }
  }

  file.batches = oldBatches
  file.favicons = oldFavicons

  return {
    batches: newBatches,
    favicons: newFavicons,
  }
}

export async function removeTabsEntry(entry: SyncedEntry) {
  Logs.info('Sync.Google.removeTabsEntry():', entry)

  if (!entry.id || !entry.gdFileId) return

  // Load file data
  const fileData = await Google.Drive.getJsonFile<SyncedTabsFileData>(entry.gdFileId)
  if (!fileData) return
  Logs.info('Sync.Google.removeTabsEntry(): loaded fileData:', Utils.clone(fileData))

  // Remove tabs batch from this data
  const rmIndex = fileData.batches.findIndex(batch => batch.id === entry.id)
  if (rmIndex === -1) {
    throw 'No entry to remove in the file data'
  }
  fileData.batches.splice(rmIndex, 1)

  // Upd favicons
  const newFavicons: Record<string, string> = {}
  for (const batch of fileData.batches) {
    for (const tab of batch.tabs) {
      if (!tab.domain) continue

      const favicon = fileData.favicons[tab.domain]
      if (favicon && !newFavicons[tab.domain]) {
        newFavicons[tab.domain] = favicon
      }
    }
  }
  fileData.favicons = newFavicons

  // Update Google Drive files
  if (fileData.batches.length) {
    // Update file
    const fileId = entry.gdFileId
    Logs.info('Sync.Google.removeTabsEntry(): Update fileData:', fileId, Utils.clone(fileData))
    await Google.Drive.updateJsonFile({ fileId, content: fileData })

    // Update cache
    Logs.info('Sync.Google.removeTabsEntry(): Cache has this file:', cachedTabFilesData.has(fileId))
    cachedTabFilesData.set(fileId, fileData)
  } else {
    // Remove file
    await Google.Drive.deleteFile(entry.gdFileId)

    // Remove cache
    cachedTabFilesData.delete(entry.gdFileId)
  }
}
