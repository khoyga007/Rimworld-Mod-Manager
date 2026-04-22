// v1.0.2 - Unified Search & RimPy Action Bar
import React, { memo, useState, useEffect, useCallback, useMemo, useRef, useDeferredValue, startTransition } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DragDropContext, Droppable, Draggable, DropResult, DraggableProvided } from "@hello-pangea/dnd";
import { FixedSizeList as List } from "react-window";

import { Search, RefreshCw, Save, Trash2, Folder, LifeBuoy, Scaling, BarChart3, ChevronRight, ChevronLeft, Plus, X, StickyNote, Play, Wand2, Bomb } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ModInfo, PerformanceLevel, Preset } from "../types";
import CustomDialog from "../components/CustomDialog";

// Global image cache
const _imgCache: Record<string, string> = {};
const _imgLoading = new Set<string>();
const IMG_BATCH_SIZE = 8;
let _imgQueue: { id: string; path: string }[] = [];
let _imgProcessing = false;
const NEW_TAG = "NEW";
const NEW_TAG_WINDOW_SECONDS = 3 * 24 * 60 * 60;
const IMAGE_PREFETCH_ROWS = 12;
const INITIAL_VISIBLE_RANGE = { start: 0, stop: 20 };
const LARGE_MOD_LIST_THRESHOLD = 300;
const PERFORMANCE_SEARCH_DEBOUNCE_MS = 180;
const ULTRA_SEARCH_DEBOUNCE_MS = 320;
const NORMAL_ROW_HEIGHT = 110;
const ULTRA_ROW_HEIGHT = 72;
const NORMAL_OVERSCAN = 6;
const ULTRA_OVERSCAN = 2;
const ULTRA_DRAG_DISABLE_THRESHOLD = 800;
const ULTRA_HARD_OVERSCAN = 1;
const ULTRA_HARD_SEARCH_DEBOUNCE_MS = 450;

type VisibleRange = {
  start: number;
  stop: number;
};

type SearchableMod = {
  mod: ModInfo;
  name: string;
  author: string;
  tags: string[];
};

function isNewMod(mod: ModInfo) {
  if (!mod.created_at || mod.created_at <= 1) return false;
  const now = Math.floor(Date.now() / 1000);
  return now - mod.created_at <= NEW_TAG_WINDOW_SECONDS;
}

function getDisplayTags(mod: ModInfo) {
  const tags = [...(mod.custom_tags || [])];
  if (isNewMod(mod) && !tags.includes(NEW_TAG)) {
    tags.unshift(NEW_TAG);
  }
  return tags;
}

function getVisibleMods(list: ModInfo[], range: VisibleRange, prefetchRows: number) {
  if (list.length === 0) return [];
  const start = Math.max(0, range.start - prefetchRows);
  const stop = Math.min(list.length - 1, range.stop + prefetchRows);
  return list.slice(start, stop + 1);
}

function buildSearchIndex(list: ModInfo[], includeAuthorAndTags: boolean): SearchableMod[] {
  return list.map((mod) => ({
    mod,
    name: mod.name.toLowerCase(),
    author: includeAuthorAndTags ? (mod.author || "").toLowerCase() : "",
    tags: includeAuthorAndTags ? getDisplayTags(mod).map((tag) => tag.toLowerCase()) : [],
  }));
}

function processImgQueue(onLoaded: () => void) {
  if (_imgProcessing || _imgQueue.length === 0) return;
  _imgProcessing = true;
  const batch = _imgQueue.splice(0, IMG_BATCH_SIZE);
  let remaining = batch.length;
  for (const item of batch) {
    invoke<string>("read_mod_image", { path: item.path })
      .then((dataUrl) => { _imgCache[item.id] = dataUrl; })
      .catch(() => {})
      .finally(() => {
        _imgLoading.delete(item.id);
        remaining--;
        if (remaining === 0) {
          _imgProcessing = false;
          onLoaded();
          processImgQueue(onLoaded);
        }
      });
  }
}

const ModCard = memo(({ 
  mod, 
  index, 
  isActive, 
  showThumbnail,
  ultraPerformance,
  provided,
  isDragging,
  formatSize, 
  onRefresh, 
  toast,
  onToggle 
}: { 
  mod: ModInfo, 
  index: number, 
  isActive?: boolean, 
  showThumbnail: boolean,
  ultraPerformance: boolean,
  provided?: DraggableProvided,
  isDragging?: boolean,
  formatSize: any, 
  onRefresh: any, 
  toast: (msg: string, type?: string) => void,
  onToggle: (mod: ModInfo) => void 
}) => {
  const [editingNote, setEditingNote] = useState(false);
  const [noteValue, setNoteValue] = useState(mod.custom_note || "");
  const [addingTag, setAddingTag] = useState(false);
  const [newTag, setNewTag] = useState("");

  const handleSaveNote = async () => {
    try {
      await invoke("set_mod_note", { id: mod.id, note: noteValue });
      setEditingNote(false);
      onRefresh();
      toast("Note saved!", "success");
    } catch (e: any) { toast(e.toString(), "error"); }
  };

  const handleAddTag = async () => {
    if (!newTag.trim()) { setAddingTag(false); return; }
    try {
      const tags = [...(mod.custom_tags || []), newTag.trim()];
      await invoke("set_mod_tags", { id: mod.id, tags });
      setNewTag("");
      setAddingTag(false);
      onRefresh();
      toast("Tag added!", "success");
    } catch (e: any) { toast(e.toString(), "error"); }
  };

  const removeTag = async (tag: string) => {
    if (tag === NEW_TAG) return;
    try {
      const tags = (mod.custom_tags || []).filter(t => t !== tag);
      await invoke("set_mod_tags", { id: mod.id, tags });
      onRefresh();
      toast("Tag removed", "info");
    } catch (e: any) { toast(e.toString(), "error"); }
  };

  if (ultraPerformance) {
    return (
      <div
        ref={provided?.innerRef}
        {...provided?.draggableProps}
        {...provided?.dragHandleProps}
        className={`glass-card px-3 py-2 flex items-center gap-3 ${
          isDragging ? 'border-accent/50 ring-1 ring-accent/20 z-50' : ''
        }`}
        style={{
          ...provided?.draggableProps.style,
          willChange: "transform, opacity",
          minHeight: '64px'
        }}
      >
        {isActive && (
          <div className="w-7 h-7 flex items-center justify-center bg-accent/20 rounded-md text-[9px] font-black text-accent shrink-0">
            {index + 1}
          </div>
        )}

        <button
          type="button"
          className="flex-1 min-w-0 text-left"
          onClick={() => onToggle(mod)}
        >
          <div className="flex items-center gap-2">
            <span className={`text-sm font-bold truncate ${mod.enabled ? 'text-white' : 'text-muted-foreground'}`}>
              {mod.name}
            </span>
            {mod.workshop_name && (
              <span className="inline-flex items-center text-[8px] bg-blue-500/20 text-blue-400 px-1 rounded uppercase font-black shrink-0">
                Steam
              </span>
            )}
            <span className={`text-[8px] uppercase font-black px-1 rounded border shrink-0 ${
              mod.source === 'official' ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400' :
              mod.source === 'workshop' ? 'border-blue-500/30 text-blue-400' :
              'border-green-500/30 text-green-400'
            }`}>
              {mod.source}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground min-w-0">
            <span className="truncate">{mod.author || 'Unknown'}</span>
            {mod.missing_dependencies?.length > 0 && (
              <span className="text-red-400 shrink-0">
                Missing {mod.missing_dependencies.length}
              </span>
            )}
            <span className="font-mono ml-auto shrink-0">{formatSize(mod.size_bytes)}</span>
          </div>
        </button>

        <button
          onClick={() => invoke("open_path_or_url", { target: mod.path })}
          className="p-1 hover:bg-white/10 rounded text-muted-foreground shrink-0"
          title="Open Folder"
        >
          <Folder size={14} />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={provided?.innerRef}
      {...provided?.draggableProps}
      {...provided?.dragHandleProps}
      className={`glass-card p-3 flex flex-col gap-2 group ${
        ultraPerformance
          ? (isDragging ? 'border-accent/50 ring-1 ring-accent/20 z-50' : '')
          : `transition-all duration-200 ${isDragging ? 'shadow-2xl border-accent/50 scale-[1.02] ring-2 ring-accent/30 z-50' : 'hover:border-white/20'}`
      }`}
      style={{ 
        ...provided?.draggableProps.style,
        willChange: "transform, opacity",
        minHeight: '102px'
      }}
    >
      <div className="flex items-center gap-3">
        {isActive && (
          <div className="w-8 h-8 flex items-center justify-center bg-accent/20 rounded-md text-[10px] font-black text-accent shrink-0">
            {index + 1}
          </div>
        )}
        
        <div className="w-12 h-12 rounded-lg bg-black/40 flex-shrink-0 overflow-hidden relative border border-white/5 shadow-inner">
          {showThumbnail && _imgCache[mod.id] ? (
            <img src={_imgCache[mod.id]} alt="" className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <div className="w-full h-full flex items-center justify-center opacity-30"><Folder size={20} /></div>
          )}
          {!mod.enabled && <div className="absolute inset-0 bg-black/60 backdrop-grayscale-[1]" />}
        </div>

        <div className="flex-1 min-w-0" onClick={() => onToggle(mod)}>
          <div className="flex items-center justify-between mb-0.5">
            <h3 className={`text-sm font-bold truncate flex items-center gap-1.5 ${mod.enabled ? 'text-white' : 'text-muted-foreground'}`}>
              {mod.name}
              {mod.workshop_name && <span className="inline-flex items-center text-[8px] bg-blue-500/20 text-blue-400 px-1 rounded uppercase font-black">Steam</span>}
            </h3>
          </div>
          <div className="flex items-center gap-2 overflow-hidden">
            <span className={`text-[8px] uppercase font-black px-1 rounded border ${
              mod.source === 'official' ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400' :
              mod.source === 'workshop' ? 'border-blue-500/30 text-blue-400' : 
              'border-green-500/30 text-green-400'
            }`}>
              {mod.source}
            </span>
            <span className="text-[10px] text-muted-foreground truncate opacity-60">by {mod.author || 'Unknown'}</span>
            <span className="text-[10px] font-mono opacity-40 ml-auto">{formatSize(mod.size_bytes)}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 mt-1 border-t border-white/5 pt-2">
        {getDisplayTags(mod).map(t => (
          <span
            key={t}
            className={`flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-md ${
              t === NEW_TAG
                ? 'bg-orange-500/15 text-orange-300 border border-orange-500/30'
                : 'bg-accent/10 text-accent border border-accent/20 group/tag'
            }`}
          >
            {t}
            {t !== NEW_TAG && (
              <button onClick={() => removeTag(t)} className={ultraPerformance ? "hover:text-red-400" : "opacity-0 group-hover/tag:opacity-100 transition-opacity hover:text-red-400"}>
                <X size={10} />
              </button>
            )}
          </span>
        ))}
        {addingTag ? (
          <input 
            autoFocus
            className="bg-black/40 border border-accent/50 outline-none rounded px-1.5 py-0.5 text-[9px] w-20"
            value={newTag}
            onChange={e => setNewTag(e.target.value)}
            onBlur={handleAddTag}
            onKeyDown={e => e.key === 'Enter' && handleAddTag()}
          />
        ) : (
          <button onClick={() => setAddingTag(true)} className={`text-[9px] text-muted-foreground hover:text-accent bg-white/5 px-1.5 py-0.5 rounded-md ${ultraPerformance ? '' : 'transition-colors'}`}>
            <Plus size={10} />
          </button>
        )}
        
        <div className={`ml-auto flex gap-1 ${ultraPerformance ? '' : 'opacity-0 group-hover:opacity-100 transition-opacity'}`}>
          <button onClick={() => setEditingNote(!editingNote)} className="p-1 hover:bg-white/10 rounded" title="Add Note"><StickyNote size={12} /></button>
          <button onClick={() => invoke("open_path_or_url", { target: mod.path })} className="p-1 hover:bg-white/10 rounded" title="Open Folder"><Folder size={12} /></button>
          <button 
            onClick={() => {
              if(confirm(`Delete ${mod.name}?`)) {
                invoke("delete_mod", { id: mod.id })
                  .then(() => { 
                    toast(`${mod.name} deleted`, "success");
                    onRefresh(); 
                  })
                  .catch(e => toast(e.toString(), "error"));
              }
            }} 
            className="p-1 hover:bg-red-500/20 text-red-400 rounded" 
            title="Delete Mod"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {editingNote && (
        <div className={`mt-1 flex gap-1 ${ultraPerformance ? '' : 'animate-in zoom-in-95'}`}>
          <input 
            autoFocus
            className="flex-1 bg-black/40 border border-white/10 rounded px-2 py-1 text-[10px] text-white outline-none focus:border-accent/50"
            value={noteValue}
            onChange={e => setNoteValue(e.target.value)}
            onBlur={handleSaveNote}
            onKeyDown={e => e.key === 'Enter' && handleSaveNote()}
          />
        </div>
      )}

      {mod.missing_dependencies?.length > 0 && (
        <div className="mt-1 p-2 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2">
          <LifeBuoy size={12} className="text-red-400 shrink-0" />
          <span className="text-[10px] text-red-400 truncate">Missing: {mod.missing_dependencies.map(d => d.display_name || d.package_id).join(", ")}</span>
        </div>
      )}
    </div>
  );
});

function VirtualRow({ index, style, data }: any) {
  const mod = data.list[index];
  if (!mod) return null;

  return (
    <div style={{ ...style, padding: '0 8px 8px 8px' }}>
      <Draggable draggableId={mod.id} index={index} isDragDisabled={data.dragDisabled}>
        {(provided, snapshot) => (
          <ModCard
            mod={mod}
            index={index}
            isActive={data.isActive}
            showThumbnail={data.showThumbnail}
            ultraPerformance={data.ultraPerformance}
            provided={provided}
            isDragging={snapshot.isDragging}
            formatSize={data.formatSize}
            onRefresh={data.onRefresh}
            toast={data.toast}
            onToggle={data.onToggle}
          />
        )}
      </Draggable>
    </div>
  );
}

function PlainVirtualRow({ index, style, data }: any) {
  const mod = data.list[index];
  if (!mod) return null;

  return (
    <div style={{ ...style, padding: '0 8px 8px 8px' }}>
      <ModCard
        mod={mod}
        index={index}
        isActive={data.isActive}
        showThumbnail={data.showThumbnail}
        ultraPerformance={data.ultraPerformance}
        formatSize={data.formatSize}
        onRefresh={data.onRefresh}
        toast={data.toast}
        onToggle={data.onToggle}
      />
    </div>
  );
}

const useAutoSizer = (ref: React.RefObject<HTMLDivElement | null>) => {
  const [size, setSize] = useState({ height: 0, width: 0 });

  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setSize({
          height: entry.contentRect.height,
          width: entry.contentRect.width,
        });
      }
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref]);

  return size;
};

export default function ModsView({ 
  mods, 
  onRefresh, 
  toast,
  selectedPresetId,
  setSelectedPresetId,
  performanceLevel,
  disableThumbnails
}: { 
  mods: ModInfo[], 
  onRefresh: () => void, 
  toast: (m: string, t?: string) => void,
  selectedPresetId: string,
  setSelectedPresetId: (id: string) => void,
  performanceLevel: PerformanceLevel,
  disableThumbnails: boolean
}) {
  const { t } = useTranslation();
  const performanceMode = performanceLevel !== "normal";
  const ultraPerformance = performanceLevel === "ultra";
  const ultraHardMode = ultraPerformance && mods.length >= ULTRA_DRAG_DISABLE_THRESHOLD;
  const [modSearchText, setModSearchText] = useState("");
  const [debouncedModSearchText, setDebouncedModSearchText] = useState("");
  const deferredSearchText = useDeferredValue(debouncedModSearchText);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [localActive, setLocalActive] = useState<ModInfo[]>([]);
  const [localInactive, setLocalInactive] = useState<ModInfo[]>([]);
  const [dirty, setDirty] = useState(false);
  const [, setImgVer] = useState(0);
  const [batchStatus, setBatchStatus] = useState<{
    active: boolean; currentModName: string; progress: number; title: string;
  } | null>(null);
  const [resizeRes, setResizeRes] = useState<512 | 1024 | 2048>(1024);
  const [compressionFormat, setCompressionFormat] = useState<"smart" | "bc7" | "bc1">("smart");
  const [, setModSizes] = useState<Record<string, { total: number, assets: number }>>({});
  const [dialog, setDialog] = useState<{
    isOpen: boolean;
    type: "confirm" | "prompt";
    title: string;
    message: string;
    defaultValue?: string;
    onConfirm: (val?: string) => void;
  }>({
    isOpen: false,
    type: "confirm",
    title: "",
    message: "",
    onConfirm: () => {}
  });
  const [analyzing, setAnalyzing] = useState(false);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [inactiveVisibleRange, setInactiveVisibleRange] = useState<VisibleRange>(INITIAL_VISIBLE_RANGE);
  const [activeVisibleRange, setActiveVisibleRange] = useState<VisibleRange>(INITIAL_VISIBLE_RANGE);

  const inactiveRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const inactiveSize = useAutoSizer(inactiveRef);
  const activeSize = useAutoSizer(activeRef);

  const bumpImgVer = useCallback(() => setImgVer((v) => v + 1), []);

  const loadPresets = useCallback(async () => {
    try {
      const p = await invoke<Preset[]>("list_presets");
      setPresets(p);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    loadPresets();
  }, [loadPresets]);


  // Synchronize local state with mods prop when it changes
  useEffect(() => {
    const active = mods.filter(m => m.enabled).sort((a, b) => a.load_order - b.load_order);
    const inactive = mods.filter(m => !m.enabled);
    setLocalActive(active);
    setLocalInactive(inactive);
    setDirty(false);
  }, [mods]);

  useEffect(() => {
    const debounceMs = ultraHardMode
      ? ULTRA_HARD_SEARCH_DEBOUNCE_MS
      : ultraPerformance
        ? ULTRA_SEARCH_DEBOUNCE_MS
        : PERFORMANCE_SEARCH_DEBOUNCE_MS;
    const handle = window.setTimeout(() => {
      setDebouncedModSearchText(modSearchText);
    }, mods.length > LARGE_MOD_LIST_THRESHOLD ? debounceMs : 0);

    return () => window.clearTimeout(handle);
  }, [modSearchText, mods.length, ultraPerformance, ultraHardMode]);

  // Listen for progress events
  useEffect(() => {
    let unlisten: any;
    async function setup() {
      const u1 = await listen<any>("optimize-progress", (e) => {
        setBatchStatus(prev => prev ? { ...prev, currentModName: e.payload.message, progress: e.payload.progress } : null);
      });
      const u2 = await listen<any>("download-progress", (e) => {
        if (e.payload.workshop_id === "system_restore") {
          setBatchStatus(prev => prev ? { ...prev, currentModName: e.payload.message, progress: e.payload.progress } : null);
        }
      });
      unlisten = () => { u1(); u2(); };
    }
    setup();
    return () => { if (unlisten) unlisten(); };
  }, []);

  const onDragEnd = useCallback((result: DropResult) => {
    if (!result.destination) return;
    const { source, destination } = result;

    if (source.droppableId === destination.droppableId) {
      const items = source.droppableId === "active" ? [...localActive] : [...localInactive];
      const [reorderedItem] = items.splice(source.index, 1);
      items.splice(destination.index, 0, reorderedItem);

      if (source.droppableId === "active") {
        setLocalActive(items);
        setDirty(true);
      } else {
        setLocalInactive(items);
      }
    } else {
      const sourceItems = source.droppableId === "active" ? [...localActive] : [...localInactive];
      const destItems = destination.droppableId === "active" ? [...localActive] : [...localInactive];
      const [movedItem] = sourceItems.splice(source.index, 1);
      
      if (destination.droppableId === "active") {
        movedItem.enabled = true;
        destItems.splice(destination.index, 0, movedItem);
        setLocalActive(destItems);
        setLocalInactive(sourceItems);
        setDirty(true);
      } else {
        movedItem.enabled = false;
        destItems.splice(destination.index, 0, movedItem);
        setLocalActive(sourceItems);
        setLocalInactive(destItems);
        setDirty(true);
      }
    }
  }, [localActive, localInactive]);

  const saveOrder = async () => {
    try {
      const ids = localActive.map(m => m.id);
      await invoke("set_load_order", { ids });
      
      // If a preset is selected, ask to update it too
      if (selectedPresetId) {
        const activePreset = presets.find(p => p.id === selectedPresetId);
        if (activePreset) {
          setDialog({
            isOpen: true,
            type: "confirm",
            title: t('mods.update_profile_title') || "Update Profile",
            message: t('mods.update_preset_confirm', { name: activePreset.name }),
            onConfirm: async () => {
              try {
                await invoke("update_preset", { id: selectedPresetId, modIds: ids });
                toast(t('collections.update_success', { name: activePreset.name, count: ids.length }), "success");
                loadPresets();
                setDialog(prev => ({ ...prev, isOpen: false }));
              } catch (err: any) { toast(err.toString(), "error"); }
            }
          });
        }
      }

      setDirty(false);
      toast(t('mods.save_success'), "success");
      onRefresh();
    } catch (e: any) {
      toast(e.toString(), "error");
    }
  };

  const autoSort = async () => {
    setDialog({
      isOpen: true,
      type: "confirm",
      title: t('mods.auto_sort'),
      message: t('mods.auto_sort_confirm') || "Apply community-verified rules to sort your load order?",
      onConfirm: async () => {
        setDialog(prev => ({ ...prev, isOpen: false }));
        try {
          await invoke("apply_auto_sort", { activeIds: localActive.map(m => m.id) });
          toast("Auto-sort complete!", "success");
          onRefresh();
        } catch (e: any) {
          toast(e.toString(), "error");
        }
      }
    });
  };

  const optimizeAll = async () => {
    const localMods = localActive.filter(m => m.source === "local");
    if (localMods.length === 0) {
      toast("No local mods active to optimize!", "warning");
      return;
    }
    setBatchStatus({ active: true, currentModName: "Starting...", progress: 0, title: "Optimizing Textures" });
    try {
      await invoke("resize_all_local_mods", { 
        maxRes: resizeRes,
        format: compressionFormat
      });
      toast("Optimization complete!", "success");
      onRefresh();
    } catch (e: any) {
      toast(e.toString(), "error");
    } finally {
      setBatchStatus(null);
    }
  };

  const analyzeAllSizes = async () => {
    setAnalyzing(true);
    try {
      const results = await invoke<Record<string, { total: number, assets: number }>>("analyze_mod_sizes");
      setModSizes(results);
      toast("Size analysis complete!", "info");
    } catch (e: any) {
      toast(e.toString(), "error");
    } finally {
      setAnalyzing(false);
    }
  };

  const restoreSystem = async () => {
    setDialog({
      isOpen: true,
      type: "confirm",
      title: t('mods.system_restore'),
      message: t('mods.restore_confirm') || "This will download 2.5GB of core assets to ensure game stability. Continue?",
      onConfirm: async () => {
        setDialog(prev => ({ ...prev, isOpen: false }));
        setBatchStatus({ active: true, currentModName: "Initializing...", progress: 0, title: "System Restore" });
        try {
          await invoke("restore_all_local_mods");
          toast("Restore complete!", "success");
        } catch (e: any) {
          toast(e.toString(), "error");
        } finally {
          setBatchStatus(null);
        }
      }
    });
  };

  const nukeAll = () => {
    setDialog({
      isOpen: true,
      type: "confirm",
      title: "☢️ OPERATION NUKE",
      message: "CRITICAL WARNING: This will PERMANENTLY DELETE ALL mods in your local Mods folder. This cannot be undone. Are you absolutely sure you want to wipe everything?",
      onConfirm: async () => {
        setDialog(prev => ({ ...prev, isOpen: false }));
        try {
          const count = await invoke<number>("nuke_local_mods");
          toast(`Nuke successful! Deleted ${count} local mods.`, "success");
          onRefresh();
        } catch (err: any) { toast(err.toString(), "error"); }
      }
    });
  };

  const formatSize = useCallback((bytes: number) => {
    if (!bytes) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  }, []);

  const enableAll = () => {
    const newActive = [...localActive, ...localInactive.map(m => ({ ...m, enabled: true }))];
    setLocalActive(newActive);
    setLocalInactive([]);
    setDirty(true);
  };

  const disableAll = () => {
    // Keep official mods active
    const officialMods = localActive.filter(m => m.source === "official" || m.author === "Ludeon Studios");
    const otherMods = localActive.filter(m => m.source !== "official" && m.author !== "Ludeon Studios");
    
    if (otherMods.length === 0) {
      toast("No non-official mods to disable!", "info");
      return;
    }

    const newInactive = [...localInactive, ...otherMods.map(m => ({ ...m, enabled: false }))];
    setLocalInactive(newInactive);
    setLocalActive(officialMods);
    setDirty(true);
  };

  const handleSearchChange = useCallback((value: string) => {
    startTransition(() => {
      setModSearchText(value);
    });
  }, []);

  const includeDetailedSearch = !ultraPerformance;
  const inactiveSearchIndex = useMemo(
    () => buildSearchIndex(localInactive, includeDetailedSearch),
    [localInactive, includeDetailedSearch]
  );
  const activeSearchIndex = useMemo(
    () => buildSearchIndex(localActive, includeDetailedSearch),
    [localActive, includeDetailedSearch]
  );

  const filteredInactive = useMemo(() => {
    const search = deferredSearchText.toLowerCase();
    const activeTag = ultraPerformance ? null : selectedTag;
    return inactiveSearchIndex.filter(({ name, author, tags }) => {
      const matchesSearch = !search || name.includes(search) || author.includes(search);
      const matchesTag = !activeTag || tags.includes(activeTag.toLowerCase());
      return matchesSearch && matchesTag;
    }).map(({ mod }) => mod);
  }, [inactiveSearchIndex, deferredSearchText, selectedTag, ultraPerformance]);

  const filteredActive = useMemo(() => {
    const search = deferredSearchText.toLowerCase();
    const activeTag = ultraPerformance ? null : selectedTag;
    return activeSearchIndex.filter(({ name, author, tags }) => {
      const matchesSearch = !search || name.includes(search) || author.includes(search);
      const matchesTag = !activeTag || tags.includes(activeTag.toLowerCase());
      return matchesSearch && matchesTag;
    }).map(({ mod }) => mod);
  }, [activeSearchIndex, deferredSearchText, selectedTag, ultraPerformance]);

  const allTags = useMemo(() => {
    if (ultraPerformance) return [];
    const tags = new Set<string>();
    mods.forEach(m => getDisplayTags(m).forEach(t => tags.add(t)));
    return Array.from(tags);
  }, [mods, ultraPerformance]);
  const imagePrefetchRows = ultraPerformance ? 0 : performanceMode ? 2 : IMAGE_PREFETCH_ROWS;
  const shouldLoadImages = !disableThumbnails && !ultraPerformance && (!performanceMode || mods.length <= LARGE_MOD_LIST_THRESHOLD);
  const showThumbnail = !disableThumbnails;
  const itemSize = ultraPerformance ? ULTRA_ROW_HEIGHT : NORMAL_ROW_HEIGHT;
  const dragDisabled = ultraHardMode;
  const overscanCount = ultraHardMode ? ULTRA_HARD_OVERSCAN : ultraPerformance ? ULTRA_OVERSCAN : NORMAL_OVERSCAN;
  const inactiveListData = useMemo(() => ({
    list: filteredInactive,
    formatSize,
    onRefresh,
    toast,
    showThumbnail,
    ultraPerformance,
    dragDisabled,
    onToggle: (mod: ModInfo) => {
      setLocalInactive(prev => prev.filter(m => m.id !== mod.id));
      setLocalActive(prev => [...prev, { ...mod, enabled: true }]);
      setDirty(true);
    }
  }), [filteredInactive, formatSize, onRefresh, toast, showThumbnail, ultraPerformance, dragDisabled]);
  const activeListData = useMemo(() => ({
    list: filteredActive,
    formatSize,
    onRefresh,
    toast,
    isActive: true,
    showThumbnail,
    ultraPerformance,
    dragDisabled,
    onToggle: (mod: ModInfo) => {
      if (mod.source === "official" || mod.author === "Ludeon Studios") {
        toast("Cannot disable official game content!", "warning");
        return;
      }
      setLocalActive(prev => prev.filter(m => m.id !== mod.id));
      setLocalInactive(prev => [{ ...mod, enabled: false }, ...prev]);
      setDirty(true);
    }
  }), [filteredActive, formatSize, onRefresh, toast, showThumbnail, ultraPerformance, dragDisabled]);

  // Image lazy loading aligned with virtualized visible ranges
  useEffect(() => {
    if (!shouldLoadImages) return;

    let queued = false;
    const visibleMods = [
      ...getVisibleMods(filteredActive, activeVisibleRange, imagePrefetchRows),
      ...getVisibleMods(filteredInactive, inactiveVisibleRange, imagePrefetchRows),
    ];

    for (const m of visibleMods) {
      if (m.picture && !_imgCache[m.id] && !_imgLoading.has(m.id)) {
        _imgLoading.add(m.id);
        _imgQueue.push({ id: m.id, path: m.picture });
        queued = true;
      }
    }

    if (queued) processImgQueue(bumpImgVer);
  }, [filteredActive, filteredInactive, activeVisibleRange, inactiveVisibleRange, bumpImgVer, imagePrefetchRows, shouldLoadImages]);

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">
      {/* RIMPY STYLE ACTION BAR */}
      <div className="flex items-center justify-between p-2 bg-black/40 border-b border-white/5 backdrop-blur-md z-10">
        <div className="flex items-center gap-1">
          <button 
            onClick={saveOrder}
            disabled={!dirty}
            className={`p-2 rounded-lg flex items-center gap-2 ${ultraPerformance ? '' : 'transition-all'} ${
              dirty ? 'bg-accent text-accent-foreground shadow-lg shadow-accent/20 scale-105' : 'bg-white/5 text-muted-foreground opacity-50'
            }`}
          >
            <Save size={16} />
            <span className="text-xs font-bold uppercase tracking-tighter">{t('common.save')}</span>
          </button>

          <div className="h-6 w-px bg-white/10 mx-2" />

          {/* Profile Dropdown */}
          <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1 border border-white/5">
            <select 
              value={selectedPresetId}
              onChange={async (e) => {
                const id = e.target.value;
                if (!id) return;
                setSelectedPresetId(id);
                try {
                  await invoke("apply_preset", { id });
                  toast("Profile applied!", "success");
                  onRefresh();
                } catch (err: any) { toast(err.toString(), "error"); }
              }}
              className="bg-transparent border-none outline-none text-[10px] font-bold uppercase tracking-widest text-accent px-2 py-1 cursor-pointer"
            >
              <option value="" className="bg-[#1a1b1e]">{t('mods.select_profile')}</option>
              {presets.map(p => (
                <option key={p.id} value={p.id} className="bg-[#1a1b1e]">{p.name}</option>
              ))}
            </select>
            
            <button 
              onClick={() => {
                setDialog({
                  isOpen: true,
                  type: "prompt",
                  title: t('mods.new_profile'),
                  message: t('mods.new_profile_prompt'),
                  onConfirm: async (name) => {
                    if (!name) return;
                    try {
                      await invoke("create_preset", { name, modIds: localActive.map(m => m.id) });
                      toast("Profile created!", "success");
                      loadPresets();
                      setDialog(prev => ({ ...prev, isOpen: false }));
                    } catch (err: any) { toast(err.toString(), "error"); }
                  }
                });
              }}
              className="p-1 hover:bg-white/10 rounded text-muted-foreground"
              title="Create New Profile"
            >
              <Plus size={14} />
            </button>

            {selectedPresetId && (
              <button 
                onClick={() => {
                  const activePreset = presets.find(p => p.id === selectedPresetId);
                  setDialog({
                    isOpen: true,
                    type: "confirm",
                    title: t('common.delete'),
                    message: t('mods.delete_profile_confirm', { name: activePreset?.name }),
                    onConfirm: async () => {
                      try {
                        await invoke("delete_preset", { id: selectedPresetId });
                        setSelectedPresetId("");
                        toast("Profile deleted", "info");
                        loadPresets();
                        setDialog(prev => ({ ...prev, isOpen: false }));
                      } catch (err: any) { toast(err.toString(), "error"); }
                    }
                  });
                }}
                className="p-1 hover:bg-red-500/20 text-red-400 rounded"
                title="Delete Profile"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
          
          <div className="h-6 w-px bg-white/10 mx-2" />

          <div className="flex items-center bg-white/5 rounded-lg p-0.5 border border-white/5">
              <button 
              onClick={autoSort}
              className={`p-1.5 hover:bg-white/10 rounded-md text-accent flex items-center gap-2 group ${ultraPerformance ? '' : 'transition-colors'}`}
              title={t('mods.auto_sort')}
            >
              <Wand2 size={16} className={ultraPerformance ? "" : "group-hover:rotate-12 transition-transform"} />
              <span className="text-[10px] font-black uppercase tracking-tighter pr-1">{t('mods.auto_sort')}</span>
            </button>
            <div className="w-px h-4 bg-white/10 mx-1" />
            <button 
              onClick={analyzeAllSizes}
              disabled={analyzing}
              className={`p-1.5 hover:bg-white/10 rounded-md text-muted-foreground group relative ${ultraPerformance ? '' : 'transition-colors'}`}
              title={t('mods.analyze_sizes')}
            >
              {analyzing ? <RefreshCw size={16} className={`${ultraPerformance ? '' : 'animate-spin'} text-accent`} /> : <BarChart3 size={16} />}
            </button>
            <button 
              onClick={restoreSystem}
              className={`p-1.5 hover:bg-white/10 rounded-md text-muted-foreground group relative ${ultraPerformance ? '' : 'transition-colors'}`}
              title={t('mods.system_restore')}
            >
              <LifeBuoy size={16} />
            </button>
            <button 
              onClick={nukeAll}
              className={`p-1.5 hover:bg-red-500/10 rounded-md text-muted-foreground hover:text-red-500 group relative ${ultraPerformance ? '' : 'transition-colors'}`}
              title="NUKE LOCAL MODS"
            >
              <Bomb size={16} />
            </button>
          </div>

          <div className="h-6 w-px bg-white/10 mx-2" />

          {/* Texture Optimization Cluster */}
          <div className="flex items-center gap-1 bg-accent/5 p-1 rounded-xl border border-accent/10">
             {/* Resolution Toggle */}
             <button 
               onClick={() => setResizeRes(prev => prev === 512 ? 1024 : prev === 1024 ? 2048 : 512)}
               className={`px-2 py-1 bg-black/40 rounded-lg text-[10px] font-black text-accent border border-accent/20 hover:bg-accent/10 ${ultraPerformance ? '' : 'transition-colors'}`}
               title="Click to Cycle Resolution"
             >
               {resizeRes}px
             </button>

             {/* Compression Toggle */}
             <button 
               onClick={() => setCompressionFormat(prev => prev === "smart" ? "bc7" : prev === "bc7" ? "bc1" : "smart")}
               className={`px-2 py-1 bg-black/40 rounded-lg text-[10px] font-black text-accent/70 border border-accent/10 hover:bg-accent/10 uppercase ${ultraPerformance ? '' : 'transition-colors'}`}
               title="Compression Format"
             >
               {compressionFormat}
             </button>

             <button 
              onClick={optimizeAll}
              className={`p-1.5 bg-accent text-accent-foreground rounded-lg hover:brightness-110 flex items-center gap-2 ${ultraPerformance ? '' : 'transition-all'}`}
              title={t('mods.optimize')}
            >
              <Scaling size={16} />
              <span className="text-[10px] font-black uppercase">{t('mods.optimize')}</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={() => invoke("launch_rimworld").catch(e => toast(e.toString(), "error"))}
            className={`flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-black uppercase text-xs shadow-lg shadow-emerald-900/20 group ${ultraPerformance ? '' : 'transition-all active:scale-95'}`}
          >
            <Play size={16} className="fill-current" />
            <span>{t('mods.launch_game')}</span>
          </button>

          <div className={`flex items-center bg-white/5 rounded-full px-3 py-1.5 border border-white/5 focus-within:border-accent/50 w-64 shadow-inner ${ultraPerformance ? '' : 'transition-all'}`}>
            <Search size={14} className="text-muted-foreground mr-2" />
            <input 
              className="bg-transparent border-none outline-none text-xs w-full placeholder:text-muted-foreground/50"
              placeholder={t('mods.search_placeholder')}
              value={modSearchText}
              onChange={e => handleSearchChange(e.target.value)}
            />
          </div>

          <button 
            onClick={async () => {
              try {
                await invoke("refresh_mods");
                onRefresh();
                toast("Mod list refreshed!", "success");
              } catch (e: any) { toast(e.toString(), "error"); }
            }}
            className={`p-2 bg-white/5 hover:bg-white/10 rounded-full text-muted-foreground ${ultraPerformance ? '' : 'transition-all hover:rotate-180 duration-500'}`}
            title={t('common.refresh')}
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Tags Filter Ribbon */}
      {!ultraPerformance && allTags.length > 0 && (
        <div className="flex items-center gap-1 p-2 bg-black/20 border-b border-white/5 overflow-x-auto no-scrollbar">
          <button 
            onClick={() => setSelectedTag(null)}
            className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase whitespace-nowrap ${ultraPerformance ? '' : 'transition-all'} ${
              !selectedTag ? 'bg-accent text-accent-foreground shadow-sm' : 'bg-white/5 text-muted-foreground hover:bg-white/10'
            }`}
          >
            {t('common.all') || 'All'}
          </button>
          {allTags.map(tag => (
            <button 
              key={tag}
              onClick={() => setSelectedTag(tag)}
              className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase whitespace-nowrap ${ultraPerformance ? '' : 'transition-all'} ${
                selectedTag === tag ? 'bg-accent text-accent-foreground shadow-sm' : 'bg-white/5 text-muted-foreground hover:bg-white/10'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {/* Batch Status Overlay */}
      {batchStatus && (
        <div className={`absolute inset-0 z-50 bg-background/80 backdrop-blur-xl flex items-center justify-center p-8 ${ultraPerformance ? '' : 'animate-in fade-in duration-300'}`}>
          <div className="max-w-md w-full glass-card p-8 border-accent/20 shadow-2xl shadow-accent/10 relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-full h-1 bg-accent/10">
              <div className={`h-full bg-accent shadow-[0_0_15px_rgba(var(--accent),0.5)] ${ultraPerformance ? '' : 'transition-all duration-300'}`} style={{ width: `${batchStatus.progress}%` }} />
            </div>
            
            <div className="flex items-center gap-4 mb-6">
              <div className={`p-3 bg-accent/10 rounded-2xl text-accent ${ultraPerformance ? '' : 'animate-pulse'}`}>
                <Scaling size={32} />
              </div>
              <div>
                <h3 className="text-xl font-black uppercase tracking-tighter text-white">{batchStatus.title}</h3>
                <p className="text-xs text-muted-foreground font-mono">Process ID: {Math.random().toString(36).substr(2, 9).toUpperCase()}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                <span>Working on</span>
                <span className="text-accent">{batchStatus.progress}%</span>
              </div>
              <div className="text-sm font-medium text-white truncate bg-white/5 p-3 rounded-lg border border-white/5">
                {batchStatus.currentModName}
              </div>
              <div className="h-2 bg-white/5 rounded-full overflow-hidden border border-white/5">
                <div 
                  className={`h-full bg-accent ease-out shadow-[0_0_10px_rgba(var(--accent),0.3)] ${ultraPerformance ? '' : 'transition-all duration-300'}`} 
                  style={{ width: `${batchStatus.progress}%` }} 
                />
              </div>
              <p className="text-[10px] text-center text-muted-foreground italic opacity-50">Please do not close the application during this process.</p>
            </div>
          </div>
        </div>
      )}

      {dragDisabled ? (
        <div className="flex-1 flex gap-4 overflow-hidden min-h-0 px-2">
          {/* Inactive Mods Column */}
          <div className="flex-1 flex flex-col bg-black/40 rounded-2xl border border-white/5 overflow-hidden">
            <div className="p-3 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
              <h2 className="text-sm font-black uppercase tracking-widest text-white/40 flex items-center gap-2">
                {t('mods.inactive')} <span className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded text-white/60">{localInactive.length}</span>
              </h2>
              <button onClick={enableAll} className="text-[9px] font-bold text-muted-foreground hover:text-white">{t('mods.enable_all')}</button>
            </div>
            {ultraHardMode && (
              <div className="px-3 py-2 text-[10px] text-amber-300 bg-amber-500/10 border-b border-amber-500/20">
                Ultra mode is using click-to-toggle only. Drag-and-drop is disabled for very large lists.
              </div>
            )}
            <div className="flex-1 relative" ref={inactiveRef}>
              {inactiveSize.height > 0 && (
                <div className="h-full w-full">
                  <List
                    height={inactiveSize.height}
                    itemCount={filteredInactive.length}
                    itemSize={itemSize}
                    overscanCount={overscanCount}
                    width={inactiveSize.width}
                    onItemsRendered={({ visibleStartIndex, visibleStopIndex }) => {
                      setInactiveVisibleRange({ start: visibleStartIndex, stop: visibleStopIndex });
                    }}
                    itemData={inactiveListData}
                    className="custom-scrollbar"
                  >
                    {PlainVirtualRow}
                  </List>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col justify-center opacity-10">
            <ChevronRight size={20} />
            <ChevronLeft size={20} />
          </div>

          {/* Active Column */}
          <div className="flex-1 flex flex-col bg-black/40 rounded-2xl border border-white/5 overflow-hidden">
            <div className="p-3 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
              <h2 className="text-sm font-black uppercase tracking-widest text-accent flex items-center gap-2">
                {t('mods.active')} <span className="text-[10px] bg-accent/20 px-1.5 py-0.5 rounded text-accent">{localActive.length}</span>
              </h2>
              <button onClick={disableAll} className="text-[9px] font-bold text-muted-foreground hover:text-red-400">{t('mods.disable_all')}</button>
            </div>
            <div className="flex-1 relative" ref={activeRef}>
              {activeSize.height > 0 && (
                <div className="h-full w-full">
                  <List
                    height={activeSize.height}
                    itemCount={filteredActive.length}
                    itemSize={itemSize}
                    overscanCount={overscanCount}
                    width={activeSize.width}
                    onItemsRendered={({ visibleStartIndex, visibleStopIndex }) => {
                      setActiveVisibleRange({ start: visibleStartIndex, stop: visibleStopIndex });
                    }}
                    itemData={activeListData}
                    className="custom-scrollbar"
                  >
                    {PlainVirtualRow}
                  </List>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex-1 flex gap-4 overflow-hidden min-h-0 px-2">
            {/* Inactive Mods Column */}
            <div className="flex-1 flex flex-col bg-black/40 rounded-2xl border border-white/5 overflow-hidden">
              <div className="p-3 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
                <h2 className="text-sm font-black uppercase tracking-widest text-white/40 flex items-center gap-2">
                  {t('mods.inactive')} <span className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded text-white/60">{localInactive.length}</span>
                </h2>
                <button onClick={enableAll} className="text-[9px] font-bold text-muted-foreground hover:text-white">{t('mods.enable_all')}</button>
              </div>
              <div className="flex-1 relative" ref={inactiveRef}>
                {inactiveSize.height > 0 && (
                  <Droppable
                    droppableId="inactive"
                    mode="virtual"
                    renderClone={(provided, snapshot, rubric) => (
                      <ModCard
                        mod={filteredInactive[rubric.source.index]}
                        index={rubric.source.index}
                        showThumbnail={showThumbnail}
                        ultraPerformance={ultraPerformance}
                        provided={provided}
                        isDragging={snapshot.isDragging}
                        formatSize={formatSize}
                        onRefresh={onRefresh}
                        toast={toast}
                        onToggle={() => {}}
                      />
                    )}
                  >
                    {(provided) => (
                      <div className="h-full w-full">
                        <List
                          height={inactiveSize.height}
                          itemCount={filteredInactive.length}
                          itemSize={itemSize}
                          overscanCount={overscanCount}
                          width={inactiveSize.width}
                          outerRef={provided.innerRef}
                          onItemsRendered={({ visibleStartIndex, visibleStopIndex }) => {
                            setInactiveVisibleRange({ start: visibleStartIndex, stop: visibleStopIndex });
                          }}
                          itemData={inactiveListData}
                          className="custom-scrollbar"
                        >
                          {VirtualRow}
                        </List>
                      </div>
                    )}
                  </Droppable>
                )}
              </div>
            </div>

            <div className="flex flex-col justify-center opacity-10">
              <ChevronRight size={20} />
              <ChevronLeft size={20} />
            </div>

            {/* Active Column */}
            <div className="flex-1 flex flex-col bg-black/40 rounded-2xl border border-white/5 overflow-hidden">
              <div className="p-3 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
                <h2 className="text-sm font-black uppercase tracking-widest text-accent flex items-center gap-2">
                  {t('mods.active')} <span className="text-[10px] bg-accent/20 px-1.5 py-0.5 rounded text-accent">{localActive.length}</span>
                </h2>
                <button onClick={disableAll} className="text-[9px] font-bold text-muted-foreground hover:text-red-400">{t('mods.disable_all')}</button>
              </div>
              <div className="flex-1 relative" ref={activeRef}>
                {activeSize.height > 0 && (
                  <Droppable
                    droppableId="active"
                    mode="virtual"
                    renderClone={(provided, snapshot, rubric) => (
                      <ModCard
                        mod={filteredActive[rubric.source.index]}
                        index={rubric.source.index}
                        showThumbnail={showThumbnail}
                        ultraPerformance={ultraPerformance}
                        provided={provided}
                        isDragging={snapshot.isDragging}
                        isActive
                        formatSize={formatSize}
                        onRefresh={onRefresh}
                        toast={toast}
                        onToggle={() => {}}
                      />
                    )}
                  >
                    {(provided) => (
                      <div className="h-full w-full">
                        <List
                          height={activeSize.height}
                          itemCount={filteredActive.length}
                          itemSize={itemSize}
                          overscanCount={overscanCount}
                          width={activeSize.width}
                          outerRef={provided.innerRef}
                          onItemsRendered={({ visibleStartIndex, visibleStopIndex }) => {
                            setActiveVisibleRange({ start: visibleStartIndex, stop: visibleStopIndex });
                          }}
                          itemData={activeListData}
                          className="custom-scrollbar"
                        >
                          {VirtualRow}
                        </List>
                      </div>
                    )}
                  </Droppable>
                )}
              </div>
            </div>
          </div>
        </DragDropContext>
      )}

      {/* Global Custom Dialog */}
      <CustomDialog
        isOpen={dialog.isOpen}
        type={dialog.type}
        title={dialog.title}
        message={dialog.message}
        defaultValue={dialog.defaultValue}
        onConfirm={dialog.onConfirm}
        onCancel={() => setDialog(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
