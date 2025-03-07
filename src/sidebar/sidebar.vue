<template lang="pug">
#root.root.Sidebar(
  ref="rootEl"
  :key="rrc"
  :data-native-scrollbar="Settings.state.nativeScrollbars"
  :data-native-scrollbars-thin="Settings.state.nativeScrollbarsThin"
  :data-native-scrollbars-left="Settings.state.nativeScrollbarsLeft"
  :data-theme="Settings.state.theme"
  :data-density="Settings.state.density"
  :data-frame-color-scheme="Styles.reactive.frameColorScheme"
  :data-toolbar-color-scheme="Styles.reactive.toolbarColorScheme"
  :data-act-el-color-scheme="Styles.reactive.actElColorScheme"
  :data-popup-color-scheme="Styles.reactive.popupColorScheme"
  :data-animations="animations"
  :data-pinned-tabs-position="Settings.state.pinnedTabsPosition"
  :data-pinned-tabs-list="Settings.state.pinnedTabsList"
  :data-tabs-tree-lvl-marks="Settings.state.tabsLvlDots"
  :data-tabs-close-btn="Settings.state.tabRmBtn"
  :data-drag="DnD.reactive.isStarted"
  :data-nav-inline="Settings.state.navBarInline"
  :data-nav-layout="navBarLayout"
  :data-search="!!Search.reactive.value"
  :data-sticky-bookmarks="Settings.state.pinOpenedBookmarksFolder"
  :data-colorized-branches="Settings.state.colorizeTabsBranches"
  :data-syncing="Sync.reactive.syncing"
  @dragend="DnD.onDragEnd"
  @dragenter="DnD.onDragEnter"
  @dragleave="DnD.onDragLeave"
  @dragover.prevent="DnD.onDragMove"
  @drop.stop.prevent="DnD.onDrop"
  @contextmenu.stop.prevent
  @mouseenter="onMouseEnter"
  @mouseleave="onMouseLeave"
  @mousedown="onMouseDown"
  @mouseup="onMouseUp"
  @mousemove.passive="Mouse.onMouseMove"
  @focusin="onFocusIn"
  @focusout="onFocusOut")

  Transition(name="popup" type="transition"): ConfirmPopup(v-if="Popups.reactive.confirm")
  Transition(name="popup" type="transition"): WindowsPopup(v-if="Windows.reactive.choosing")
  Transition(name="popup" type="transition"): BookmarksPopup(v-if="Bookmarks.reactive.popup")
  Transition(name="popup" type="transition"): PanelConfigPopup(v-if="Popups.reactive.panelConfigPopup")
  Transition(name="popup" type="transition"): ContainerConfigPopup(v-if="Popups.reactive.containerConfigPopup")
  Transition(name="popup" type="transition"): GroupConfigPopup(v-if="Popups.reactive.groupConfigPopup")
  Transition(name="popup" type="transition"): DialogPopup(v-if="Popups.reactive.dialog" :dialog="Popups.reactive.dialog")
  Transition(name="popup" type="transition"): NewTabShortcutsPopup(v-if="Popups.reactive.newTabShortcutsPopup")
  Transition(name="popup" type="transition"): SiteConfigPopup(v-if="Popups.reactive.siteConfigPopup")
  CtxMenuPopup
  DragAndDropTooltip
  NotificationsPopup

  .top-horizontal-box(v-if="navBarHorizontal")
    NavigationBar.-top

  SearchBar(v-if="navBarHorizontal" v-show="Settings.state.searchBarMode !== 'none'")

  .main-box
    .left-vertical-box(v-if="pinnedTabsBarLeft || navBarLeft")
      PinnedTabsBar(v-if="pinnedTabsBarLeft")
      NavigationBar.-vert(v-if="navBarLeft")

    .central-box
      PinnedTabsBar(v-if="pinnedTabsBarTop")
      SearchBar(v-if="!navBarHorizontal" v-show="Settings.state.searchBarMode !== 'none'")
      .panel-box(ref="panelBoxEl" @wheel.passive="onWheel")
        component.panel(
          v-for="(panel, i) in panels"
          :key="panel.id"
          :is="getPanelComponent(panel)"
          :data-pos="getPanelPos(i, panel.id)"
          :panel="panel")

      Transition(name="bottom-bar")
        .BottomBar(
          v-if="bottomBar && Utils.isTabsPanel(activePanel)"
          @dragover.prevent.stop=""
          :data-drop-target-bookmarks="DnD.reactive.dstType === DropType.BookmarksSubPanelBtn && DnD.reactive.dstPanelId === activePanel.id"
          :data-drop-target-sync="DnD.reactive.dstType === DropType.SyncSubPanelBtn")
          .tool-btn(
            v-if="Settings.state.subPanelRecentlyClosedBar"
            :data-disabled="!Tabs.reactive.recentlyRemovedLen"
            @click="Sidebar.openSubPanel(SubPanelType.RecentlyClosedTabs, activePanel)")
            svg: use(xlink:href="#icon_trash")
          .tool-btn.-bookmarks(
            v-if="Settings.state.subPanelBookmarks"
            @dragleave="onBSPBDragLeave"
            @click="Sidebar.openSubPanel(SubPanelType.Bookmarks, activePanel)")
            .dnd-layer(data-dnd-type="bspb")
            svg: use(xlink:href="#icon_bookmarks")
          .tool-btn(
            v-if="Settings.state.subPanelHistory"
            @click="Sidebar.openSubPanel(SubPanelType.History, activePanel)")
            svg: use(xlink:href="#icon_clock")
          .tool-btn.-sync(
            v-if="Settings.state.subPanelSync"
            @dragleave="onSSPBDragLeave"
            @click="Sidebar.openSubPanel(SubPanelType.Sync, activePanel)")
            .dnd-layer(data-dnd-type="sspb")
            svg: use(xlink:href="#icon_sync")

      SubPanel

    .right-vertical-box(v-if="pinnedTabsBarRight || navBarRight")
      PinnedTabsBar(v-if="pinnedTabsBarRight")
      NavigationBar.-vert(v-if="navBarRight")
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, Component, nextTick } from 'vue'
import { PanelType, Panel, MenuType, WheelDirection, DropType } from 'src/types'
import { SubPanelType } from 'src/types'
import { NOID } from 'src/defaults'
import { Settings } from 'src/services/settings'
import { GroupConfigResult, Sidebar } from 'src/services/sidebar'
import { Styles } from 'src/services/styles'
import { Selection } from 'src/services/selection'
import { Menu } from 'src/services/menu'
import { Tabs } from 'src/services/tabs.fg'
import { Mouse } from 'src/services/mouse'
import { DnD } from 'src/services/drag-and-drop'
import { Bookmarks } from 'src/services/bookmarks'
import { Windows } from 'src/services/windows'
import { Search } from 'src/services/search'
import { SwitchingTabScope } from 'src/services/tabs.fg.actions'
import { Sync } from 'src/services/_services'
import ConfirmPopup from './components/popup.confirm.vue'
import CtxMenuPopup from './components/popup.context-menu.vue'
import DragAndDropTooltip from './components/dnd-tooltip.vue'
import PinnedTabsBar from './components/bar.pinned-tabs.vue'
import NotificationsPopup from './components/popup.notifications.vue'
import NavigationBar from './components/bar.navigation.vue'
import WindowsPopup from './components/popup.windows.vue'
import TabsPanel from './components/panel.tabs.vue'
import BookmarksPanel from './components/panel.bookmarks.vue'
import HistoryPanel from './components/panel.history.vue'
import SyncPanel from './components/panel.sync.vue'
import SearchBar from './components/bar.search.vue'
import BookmarksPopup from 'src/components/popup.bookmarks.vue'
import PanelConfigPopup from './components/popup.panel-config.vue'
import ContainerConfigPopup from './components/popup.container-config.vue'
import GroupConfigPopup from './components/popup.group-config.vue'
import DialogPopup from 'src/components/popup.dialog.vue'
import NewTabShortcutsPopup from '../components/popup.new-tab-shortcuts.vue'
import SiteConfigPopup from '../components/popup.site-config.vue'
import SubPanel from './components/sub-panel.vue'
import * as Utils from 'src/utils'
import * as Popups from 'src/services/popups'
import * as Logs from 'src/services/logs'
import * as Preview from 'src/services/tabs.preview'

const rootEl = ref<HTMLElement | null>(null)
const panelBoxEl = ref<HTMLElement | null>(null)
const rrc = ref(0)

let animations = !Settings.state.animations ? 'none' : Settings.state.animationSpeed || 'fast'
let pinnedTabsBarTop = Settings.state.pinnedTabsPosition === 'top'
let pinnedTabsBarLeft = Settings.state.pinnedTabsPosition === 'left'
let pinnedTabsBarRight = Settings.state.pinnedTabsPosition === 'right'
let navBarHorizontal = Settings.state.navBarLayout === 'horizontal'
let navBarVertical = Settings.state.navBarLayout === 'vertical'
let navBarLayout = navBarVertical ? Settings.state.navBarSide : Settings.state.navBarLayout
let navBarLeft = navBarVertical && Settings.state.navBarSide === 'left'
let navBarRight = navBarVertical && Settings.state.navBarSide === 'right'
let bottomBar =
  Settings.state.subPanelRecentlyClosedBar ||
  Settings.state.subPanelBookmarks ||
  Settings.state.subPanelHistory ||
  Settings.state.subPanelSync

function recalcStaticVars() {
  animations = !Settings.state.animations ? 'none' : Settings.state.animationSpeed || 'fast'
  pinnedTabsBarTop = Settings.state.pinnedTabsPosition === 'top'
  pinnedTabsBarLeft = Settings.state.pinnedTabsPosition === 'left'
  pinnedTabsBarRight = Settings.state.pinnedTabsPosition === 'right'
  navBarHorizontal = Settings.state.navBarLayout === 'horizontal'
  navBarVertical = Settings.state.navBarLayout === 'vertical'
  navBarLayout = navBarVertical ? Settings.state.navBarSide : Settings.state.navBarLayout
  navBarLeft = navBarVertical && Settings.state.navBarSide === 'left'
  navBarRight = navBarVertical && Settings.state.navBarSide === 'right'
  bottomBar =
    Settings.state.subPanelRecentlyClosedBar ||
    Settings.state.subPanelBookmarks ||
    Settings.state.subPanelHistory ||
    Settings.state.subPanelSync
}

Sidebar.reMountSidebar = () => {
  Sidebar.rememberActivePanelScrollPosition()
  recalcStaticVars()
  rrc.value++
  nextTick(updSidebarEls)
}

const activePanel = computed<Panel | undefined>(() => {
  return Sidebar.panelsById[Sidebar.reactive.activePanelId]
})

const panels = computed<Panel[]>(() => {
  const output = []
  for (const id of Sidebar.reactive.nav) {
    const panel = Sidebar.panelsById[id]
    if (panel) output.push(panel)
  }
  return output
})

function updSidebarEls() {
  if (panelBoxEl.value) Sidebar.setPanelsBoxEl(panelBoxEl.value)
  if (rootEl.value) Sidebar.registerRootEl(rootEl.value)
  Sidebar.recalcElementSizes()
  Sidebar.recalcSidebarSize()
  Sidebar.restoreActivePanelScrollPosition()
}

onMounted(() => {
  updSidebarEls()
  document.addEventListener('keyup', onDocumentKeyup)
})

function getPanelComponent(panel: Panel): Component | undefined {
  if (panel.type === PanelType.tabs) return TabsPanel
  if (panel.type === PanelType.bookmarks) return BookmarksPanel
  if (panel.type === PanelType.history) return HistoryPanel
  if (panel.type === PanelType.sync) return SyncPanel
}

function onFocusIn(e: FocusEvent): void {
  // if (Search.reactive.barIsShowed && !Selection.isSet()) Search.focus()
}

function onFocusOut(e: FocusEvent): void {
  if ((e as MozFocusEvent).explicitOriginalTarget === e.target && !DnD.reactive.isStarted) {
    if (Menu.isOpen) Menu.close()
    Selection.resetSelection()
    if (Sidebar.reactive.hiddenPanelsPopup) Sidebar.closeHiddenPanelsPopup(true)
  }
}

function onDocumentKeyup(e: KeyboardEvent): void {
  // Close popups
  if (e.code === 'Escape') {
    // Context menu
    if (Menu.isOpen) {
      Menu.close()
      return
    }

    // Selection
    if (Selection.isSet()) Selection.resetSelection()

    // Confirm popup
    if (Popups.reactive.confirm) Popups.reactive.confirm = null

    // Windows popup
    if (Windows.reactive.choosing) Windows.closeWindowsPopup()

    // Bookmarks popup
    if (Bookmarks.reactive.popup?.close) Bookmarks.reactive.popup.close()

    // Panel config popup
    if (Popups.reactive.panelConfigPopup) Popups.closePanelPopup()

    // Conatiner config popup
    if (Popups.reactive.containerConfigPopup) Popups.closeContainerPopup()

    // Group config popup
    if (Popups.reactive.groupConfigPopup) {
      Popups.reactive.groupConfigPopup.done(GroupConfigResult.Cancel)
      Popups.reactive.groupConfigPopup = null
    }

    // Dialog popup
    if (Popups.reactive.dialog) Popups.reactive.dialog.result(null)

    // Hidden panels popup
    if (Sidebar.reactive.hiddenPanelsPopup) {
      Sidebar.closeHiddenPanelsPopup()
    }

    // New tab shortcuts popup
    if (Popups.reactive.newTabShortcutsPopup) {
      Popups.closeNewTabShortcutsPopup()
    }

    // Search bar
    if (Search.reactive.barIsShowed && Settings.state.searchBarMode === 'dynamic') {
      Search.stop()
    } else if (Search.rawValue) {
      Search.stop()
    }

    // Sub-panel
    if (Sidebar.subPanelActive) Sidebar.closeSubPanel()

    // Site config popup
    if (Popups.reactive.siteConfigPopup) Popups.closeSiteConfigPopup()
  }

  // Confirm popups
  if (e.code === 'Enter') {
    // Confirm popup
    if (Popups.reactive.confirm?.ok) Popups.reactive.confirm.ok()
  }
}

let lastDir: number | undefined
const onWheel = Mouse.getWheelDebouncer(WheelDirection.Horizontal, e => {
  if (Menu.isOpen) Menu.close()

  if (e.deltaX !== 0) Mouse.blockWheel(WheelDirection.Vertical)
  else return

  if (Settings.state.hScrollAction === 'switch_panels') {
    const dir = e.deltaX > 0 ? 1 : -1

    // Restart debouncer if direction is the same
    const restartDebouncer =
      Settings.state.onePanelSwitchPerScroll && (lastDir === undefined || lastDir === dir)
    lastDir = dir

    return Sidebar.switchPanel(dir, true, false, restartDebouncer)
  } else if (Settings.state.hScrollAction === 'switch_act_tabs') {
    if (e.deltaX > 0) return Tabs.switchToRecentlyActiveTab(SwitchingTabScope.global, 1)
    if (e.deltaX < 0) return Tabs.switchToRecentlyActiveTab(SwitchingTabScope.global, -1)
  }
})

let leaveTimeout: number | undefined
let subPanelTimeout: number | undefined
function onMouseEnter(): void {
  Mouse.mouseIn = true

  Sidebar.switchPanelBackResetTimeout()

  if (leaveTimeout) {
    clearTimeout(leaveTimeout)
    leaveTimeout = undefined
  }

  clearTimeout(subPanelTimeout)
}

function onMouseLeave(): void {
  if (
    Preview.state.status === Preview.Status.Open ||
    Preview.state.status === Preview.Status.Opening
  ) {
    Preview.closePreview()
  }

  if (DnD.dragEndedRecently) return

  Mouse.mouseIn = false
  Mouse.stopResizing()

  const activePanel = Sidebar.panelsById[Sidebar.activePanelId]
  if (!Utils.isTabsPanel(activePanel) && activePanel?.tempMode && !Search.rawValue) {
    Sidebar.switchPanelBack(300)
  }

  if (Bookmarks.reactive.popup) return

  if (Mouse.multiSelectionMode) {
    leaveTimeout = setTimeout(() => {
      Mouse.stopMultiSelection()
    }, 250)
  }

  if (Sidebar.subPanelActive && !Search.rawValue && !Menu.isOpen && !DnD.items.length) {
    Sidebar.closeSubPanel()
  }

  if (Sidebar.switchOnMouseLeave) Sidebar.switchPanelOnMouseLeave()

  if (Tabs.activateSelectedOnMouseLeave && Selection.isTabs()) {
    Tabs.activateSelectedOnMouseLeave = false

    const id = Selection.get()[0]
    const targetTab = Tabs.byId[id]
    if (!targetTab || targetTab.id === Tabs.activeId) return Selection.resetSelection()

    browser.tabs.update(id, { active: true }).catch(err => {
      Logs.err('MouseLeave: Cannot activate tab on mouseleave:', err)
    })
  }
}

function onMouseDown(e: MouseEvent): void {
  Selection.resetSelection()

  if (e.button === 1) {
    Mouse.blockWheel()
    e.preventDefault()
  }
}

function onMouseUp(e: MouseEvent): void {
  Mouse.resetClickLock(120)

  if (e.button === 0 && !e.ctrlKey && !e.shiftKey) {
    Menu.close()
    Selection.resetSelection()
    if (Sidebar.reactive.hiddenPanelsPopup) {
      Sidebar.closeHiddenPanelsPopup()
    }
  }

  const inMultiSelectionMode = Mouse.multiSelectionMode
  if (inMultiSelectionMode) Mouse.stopMultiSelection()

  if (e.button === 1) {
    if (!Settings.state.multipleMiddleClose) return

    if (inMultiSelectionMode && !Settings.state.autoMenuMultiSel && Selection.getLength() > 1) {
      return
    }

    Tabs.removeTabs(Selection.get())
  } else if (e.button === 2) {
    let type: MenuType | undefined
    if (Selection.isBookmarks()) type = MenuType.Bookmarks
    if (Selection.isTabs()) type = MenuType.Tabs
    if (type === undefined) return
    if (inMultiSelectionMode && !Settings.state.autoMenuMultiSel && Selection.getLength() > 1) {
      return
    }
    Menu.open(type, e.clientX, e.clientY)
  }
}

type PanelPosition = 'left' | 'center' | 'right'
function getPanelPos(i: number, panelId: ID): PanelPosition {
  if (panelId === Sidebar.reactive.activePanelId) return 'center'
  if (i === -1) return 'right'

  const activePanel = Sidebar.panelsById[Sidebar.activePanelId]
  if (activePanel && i > activePanel.index) return 'right'
  else return 'left'
}

let onBSPBDragLeaveTimeout: number | undefined
function onBSPBDragLeave() {
  if (Sidebar.subPanelActive) DnD.reactive.dstType = DropType.Bookmarks
  else DnD.reactive.dstType = DropType.Nowhere

  clearTimeout(onBSPBDragLeaveTimeout)
  onBSPBDragLeaveTimeout = setTimeout(() => {
    if (Sidebar.subPanelActive) Sidebar.updateBounds()
  }, 120)
}

function onSSPBDragLeave() {
  DnD.reactive.dstType = DropType.Nowhere
}
</script>
