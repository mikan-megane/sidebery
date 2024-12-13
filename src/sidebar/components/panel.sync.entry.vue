<template lang="pug">
.SyncEntry
  .sync-header
    .info
      .type(:title="title") {{title}}
      .profile(v-if="entry.sameProfile") This profile
      .profile(v-else :title="entry.profileName") {{entry.profileName}}
  .date-time {{entry.dateYYYYMMDD}} - {{entry.timeHHMM}}
  .sync-content
    .sync-tab(
      v-for="t in entry.tabs"
      :key="t.id"
      :title="`${t.title}\n---\n${t.url}`"
      :data-lvl="t.lvl"
      :data-parent="t.isParent"
      :data-color="t.containerColor"
      @mousedown="onTabMouseDown($event, t, entry)"
      @mouseup="onTabMouseUp($event, t, entry)")
      .body
        .color-layer(v-if="t.customColor" :style="{ '--tab-color': t.customColor }")
        .fav(v-if="t.favicon")
          svg.fav-icon(v-if="t.favicon.startsWith('#')"): use(:xlink:href="t.favicon")
          img.fav-icon(v-else :src="t.favicon" @error="onFavError(t)" draggable="false")
        .title {{(t.customTitle ?? t.title)}}
        .containerMark(v-if="t.containerId")
    .btn(v-if="entry.type !== Sync.SyncedEntryType.Tabs" @click="onMainAction(entry)") Import
    .btn(@click="onDelete(entry)") Delete

</template>

<script lang="ts" setup>
import { Logs, Sync } from 'src/services/_services'
import { SyncedEntry } from 'src/services/sync'
import { Keybindings } from 'src/services/keybindings'
import { Menu } from 'src/services/menu'
import { Settings } from 'src/services/settings'
import { Styles } from 'src/services/styles'
import { Favicons } from 'src/services/_services.fg'
import { Mouse } from 'src/services/mouse'
import { Tabs } from 'src/services/tabs.fg'
import { DstPlaceInfo, ItemInfo } from 'src/types'
import { Sidebar } from 'src/services/sidebar'
import { Windows } from 'src/services/windows'
import { Containers } from 'src/services/containers'

const props = defineProps<{ entry: SyncedEntry }>()
const title = getTypeTitle()

function getTypeTitle() {
  if (props.entry.type === Sync.SyncedEntryType.Tabs) return 'Tabs'
  if (props.entry.type === Sync.SyncedEntryType.Settings) return 'Settings'
  if (props.entry.type === Sync.SyncedEntryType.Styles) return 'Styles'
  if (props.entry.type === Sync.SyncedEntryType.Keybindings) return 'Keybindings'
  if (props.entry.type === Sync.SyncedEntryType.CtxMenu) return 'Context Menu'
  return 'Unknown'
}

async function onMainAction(entry: SyncedEntry) {
  Logs.info('panel.sync.entry.vue: onMainAction')

  // TODO: Show some progress

  if (entry.type === Sync.SyncedEntryType.Settings) {
    await Settings.importSyncedSettings(entry)
  }
  if (entry.type === Sync.SyncedEntryType.CtxMenu) {
    await Menu.importSyncedCtxMenu(entry)
  }
  if (entry.type === Sync.SyncedEntryType.Keybindings) {
    await Keybindings.importSyncedKeybindings(entry)
  }
  if (entry.type === Sync.SyncedEntryType.Styles) {
    await Styles.importSyncedStyles(entry)
  }
}

async function onDelete(entry: SyncedEntry) {
  Logs.info('panel.sync.entry.vue: onDelete')

  await Sync.remove(entry)
}

function onFavError(tab: Sync.EntryTab) {
  tab.favicon = Favicons.getFavPlaceholder(tab.url)
}

function onTabMouseDown(e: MouseEvent, tab: Sync.EntryTab, entry: Sync.SyncedEntry) {
  if (!entry.id || !entry.tabs) return

  const mouseTargetId = entry.id + tab.id
  Mouse.setTarget('sync.tab', mouseTargetId)
}

async function onTabMouseUp(e: MouseEvent, tab: Sync.EntryTab, entry: Sync.SyncedEntry) {
  if (!entry.id || !entry.tabs) return

  const mouseTargetId = entry.id + tab.id
  if (!Mouse.isTarget('sync.tab', mouseTargetId)) return

  Logs.info('onTabMouseUp:', tab)

  const tabInfo: ItemInfo = { id: 0, url: tab.url, title: tab.title }
  const dstInfo: DstPlaceInfo = {
    windowId: Windows.id,
    discarded: false,
    panelId: Sidebar.getRecentTabsPanelId(),
    containerId: Containers.getContainerFor(tab.url),
  }

  if (e.button === 0) {
    tabInfo.active = true
    await Tabs.open([tabInfo], dstInfo)
    return
  }

  if (e.button === 1) {
    tabInfo.active = false
    await Tabs.open([tabInfo], dstInfo)
    return
  }
}
</script>
