import { memo, useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { Search, RotateCw, Zap, Save, Trash2, Folder, LifeBuoy, Scaling, BarChart3, ChevronRight, ChevronLeft, Tag, Plus, X, StickyNote } from "lucide-react";
import type { ModInfo, Preset } from "../types";

// Global image cache
const _imgCache: Record<string, string> = {};
const _imgLoading = new Set<string>();
const IMG_BATCH_SIZE = 8;
let _imgQueue: { id: string; path: string }[] = [];
let _imgProcessing = false;

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
        remaining--;
        if (remaining === 0) {
          _imgProcessing = false;
          onLoaded();
          processImgQueue(onLoaded);
        }
      });
  }
}

interface Props {
  mods: ModInfo[];
  onRefresh: () => void;
  toast: (msg: string, type?: string) => void;
}

export default function ModsView({ mods, onRefresh, toast }: Props) {
  const [search, setSearch] = useState("");
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
  const [modSizes, setModSizes] = useState<Record<string, { total: number, assets: number }>>({});
  const [analyzing, setAnalyzing] = useState(false);

  const bumpImgVer = useCallback(() => setImgVer((v) => v + 1), []);


  // Synchronize local state with mods prop when it changes
  useEffect(() => {
    const active = mods.filter(m => m.enabled).sort((a, b) => a.load_order - b.load_order);
    const inactive = mods.filter(m => !m.enabled);
    setLocalActive(active);
    setLocalInactive(inactive);
    setDirty(false);
  }, [mods]);

  // Image lazy loading
  useEffect(() => {
    let queued = false;
    const allVisible = [...localActive, ...localInactive];
    for (const m of allVisible) {
      if (m.picture && !_imgCache[m.id] && !_imgLoading.has(m.id)) {
        _imgLoading.add(m.id);
        _imgQueue.push({ id: m.id, path: m.picture });
        queued = true;
      }
    }
    if (queued) processImgQueue(bumpImgVer);
  }, [localActive, localInactive, bumpImgVer]);

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

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    mods.forEach(m => m.custom_tags?.forEach(t => tags.add(t)));
    return Array.from(tags).sort();
  }, [mods]);

  const onDragEnd = (result: DropResult) => {
    const { source, destination } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    const newActive = Array.from(localActive);
    const newInactive = Array.from(localInactive);

    if (source.droppableId === 'active' && destination.droppableId === 'active') {
      const [removed] = newActive.splice(source.index, 1);
      newActive.splice(destination.index, 0, removed);
    } else if (source.droppableId === 'inactive' && destination.droppableId === 'inactive') {
      const [removed] = newInactive.splice(source.index, 1);
      newInactive.splice(destination.index, 0, removed);
    } else if (source.droppableId === 'inactive' && destination.droppableId === 'active') {
      const [removed] = newInactive.splice(source.index, 1);
      removed.enabled = true;
      newActive.splice(destination.index, 0, removed);
    } else if (source.droppableId === 'active' && destination.droppableId === 'inactive') {
      const [removed] = newActive.splice(source.index, 1);
      removed.enabled = false;
      newInactive.splice(destination.index, 0, removed);
    }

    setLocalActive(newActive);
    setLocalInactive(newInactive);
    setDirty(true);
  };

  const saveOrder = async () => {
    try {
      const ids = localActive.map(m => m.id);
      await invoke("set_load_order", { ids });
      toast("Load order and states saved!", "success");
      setDirty(false);
      onRefresh();
    } catch (e: any) { toast(e.toString(), "error"); }
  };

  const runAnalysis = async () => {
    setAnalyzing(true);
    try {
      const res = await invoke<Record<string, any>>("analyze_mod_sizes");
      setModSizes(res as any);
      toast("Analysis complete!", "success");
    } catch (e: any) { toast(e.toString(), "error"); } finally { setAnalyzing(false); }
  };

  const batchOptimize = async () => {
    const local = mods.filter(m => !m.path.includes("workshop"));
    if (local.length === 0) return;
    setBatchStatus({ active: true, currentModName: "Starting...", progress: 0, title: "⚡ Optimizing Textures" });
    try { await invoke("optimize_all_local_mods", { format: compressionFormat }); toast("Optimization finished!", "success"); } 
    catch (e: any) { toast(e.toString(), "error"); } finally { setBatchStatus(null); onRefresh(); }
  };

  const batchResize = async () => {
    const local = mods.filter(m => !m.path.includes("workshop"));
    if (local.length === 0) return;
    setBatchStatus({ active: true, currentModName: "Starting...", progress: 0, title: `📐 Resizing (${resizeRes}px)` });
    try { await invoke("resize_all_local_mods", { maxRes: resizeRes, format: compressionFormat }); toast("Resize finished!", "success"); } 
    catch (e: any) { toast(e.toString(), "error"); } finally { setBatchStatus(null); onRefresh(); }
  };

  const batchRestore = async () => {
    setBatchStatus({ active: true, currentModName: "Initializing...", progress: 0, title: "🆘 Emergency Restore" });
    try { await invoke("restore_all_local_mods"); toast("Restore finished!", "success"); } 
    catch (e: any) { toast(e.toString(), "error"); } finally { setBatchStatus(null); onRefresh(); }
  };

  const enableAll = async () => {
    await invoke("set_all_mods_enabled", { enabled: true });
    onRefresh();
    toast("All mods enabled", "success");
  };

  const disableAll = async () => {
    await invoke("set_all_mods_enabled", { enabled: false });
    onRefresh();
    toast("All mods disabled", "info");
  };

  const filterMod = (m: ModInfo) => {
    const matchesSearch = m.name.toLowerCase().includes(search.toLowerCase()) || 
                          m.id.toLowerCase().includes(search.toLowerCase()) ||
                          m.custom_note.toLowerCase().includes(search.toLowerCase()) ||
                          (m.workshop_name && m.workshop_name.toLowerCase().includes(search.toLowerCase())) ||
                          m.custom_tags?.some(t => t.toLowerCase().includes(search.toLowerCase()));
    const matchesTag = !selectedTag || m.custom_tags?.includes(selectedTag);
    return matchesSearch && matchesTag;
  };

  const [refreshingWS, setRefreshingWS] = useState(false);

  const refreshWorkshopInfo = async () => {
    // Sync for ANY mod that has a workshop ID, even if it's a local copy
    const workshopMods = mods.filter(m => m.remote_file_id);
    if (workshopMods.length === 0) return;

    setRefreshingWS(true);
    try {
      const ids = workshopMods.map(m => m.remote_file_id!);
      const metas = await invoke<[string, any][]>("fetch_workshop_metas", { ids });
      
      for (const [id, meta] of metas) {
        const mod = workshopMods.find(m => m.remote_file_id === id);
        if (mod && meta.title) {
          await invoke("set_mod_workshop_name", { id: mod.id, name: meta.title });
        }
      }
      toast(`Updated info for ${metas.length} mods`, "success");
      onRefresh();
    } catch (e: any) {
      toast("Failed to update workshop info: " + e.toString(), "error");
    } finally {
      setRefreshingWS(false);
    }
  };

  const filteredInactive = localInactive.filter(filterMod);
  const filteredActive = localActive.filter(filterMod);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const [presets, setPresets] = useState<Preset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);

  const loadPresets = async () => {
    try {
      const list = await invoke<Preset[]>("list_presets");
      setPresets(list);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { loadPresets(); }, []);

  const saveCurrentProfile = async () => {
    const name = prompt("Enter Profile Name (e.g. 'Middle Ages', 'Vanilla+'):");
    if (!name) return;
    const enabledIds = mods.filter(m => m.enabled).map(m => m.id);
    try {
      const p = await invoke<Preset>("create_preset", { name, modIds: enabledIds, note: `Created from ModsView` });
      setPresets(prev => [...prev, p]);
      setActivePresetId(p.id);
      toast(`Profile "${name}" saved!`, "success");
    } catch (e: any) { toast(e.toString(), "error"); }
  };

  const applyProfile = async (id: string) => {
    try {
      await invoke("apply_preset", { id });
      setActivePresetId(id);
      setDirty(false);
      onRefresh();
      toast("Profile applied!", "success");
    } catch (e: any) { toast(e.toString(), "error"); }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in p-2">
      {/* Header Area */}
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">RimWorld Mod Manager</h1>
            <p className="text-muted-foreground text-sm">Drag and drop to manage your load order</p>
          </div>
          
          {/* Quick Profile Selector */}
          <div className="h-10 px-3 bg-black/20 border border-white/5 rounded-xl flex items-center gap-3">
             <Save size={16} className="text-accent opacity-60" />
             <select 
               className="bg-transparent text-sm font-semibold outline-none cursor-pointer min-w-[120px]"
               value={activePresetId || ""}
               onChange={(e) => e.target.value === "new" ? saveCurrentProfile() : applyProfile(e.target.value)}
             >
               <option value="" disabled>Select Profile...</option>
               {presets.map(p => (
                 <option key={p.id} value={p.id}>{p.name} ({p.mod_ids.length})</option>
               ))}
               <option value="new" className="text-accent font-bold">+ Save Current Setup...</option>
             </select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {dirty && (
            <button onClick={saveOrder} className="btn-primary px-6 py-2 flex items-center gap-2 shadow-lg shadow-accent/20">
              <Save size={18} /> Save Changes
            </button>
          )}
          <button 
            onClick={refreshWorkshopInfo}
            disabled={refreshingWS}
            className={`btn-secondary flex items-center gap-2 ${refreshingWS ? 'opacity-50' : ''}`}
            title="Sync original names from Steam Workshop"
          >
            <RotateCw size={18} className={refreshingWS ? "animate-spin" : ""} />
            {refreshingWS ? "Syncing..." : "Sync Workshop"}
          </button>
          <button onClick={onRefresh} className="btn-secondary p-2"><RotateCw size={20} /></button>
        </div>
      </div>

      {/* Toolbar Area */}
      <div className="glass-card p-4 mb-2 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4 flex-1 min-w-[300px]">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" size={18} />
            <input 
              className="input-field pl-10 w-full" 
              placeholder="Search by name or tag..." 
              value={search} 
              onChange={e => setSearch(e.target.value)} 
            />
          </div>
          <button onClick={runAnalysis} disabled={analyzing} className="btn-secondary flex items-center gap-2">
            <BarChart3 size={18} /> {analyzing ? "Analyzing..." : "Analyze VRAM"}
          </button>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-black/20 p-1 rounded-lg border border-white/5">
             <span className="text-xs text-muted-foreground px-2">Format:</span>
             <select value={compressionFormat} onChange={e => setCompressionFormat(e.target.value as any)} className="bg-transparent text-sm font-semibold outline-none cursor-pointer">
                <option value="smart">Smart</option>
                <option value="bc7">BC7</option>
                <option value="bc1">BC1</option>
             </select>
          </div>
          <div className="flex items-center gap-2 bg-black/20 p-1 rounded-lg border border-white/5">
             <span className="text-xs text-muted-foreground px-2">Max:</span>
             <select value={resizeRes} onChange={e => setResizeRes(Number(e.target.value) as any)} className="bg-transparent text-sm font-semibold outline-none cursor-pointer">
                <option value={2048}>2048px</option>
                <option value={1024}>1024px</option>
                <option value={512}>512px</option>
             </select>
          </div>
          <button onClick={batchOptimize} className="btn-secondary flex items-center gap-2" title="Convert PNG to DDS">
            <Zap size={18} className="text-yellow-500" /> Optimize
          </button>
          <button onClick={batchResize} className="btn-secondary flex items-center gap-2" title="Resize and Compress">
            <Scaling size={18} className="text-blue-500" /> Resize
          </button>
          <button onClick={batchRestore} className="btn-secondary flex items-center gap-2 text-red-400" title="Redownload from Steam">
            <LifeBuoy size={18} /> Emergency
          </button>
        </div>
      </div>

      {/* Tags Filter Strip */}
      {allTags.length > 0 && (
        <div className="flex items-center gap-2 mb-6 overflow-x-auto py-1 px-2 no-scrollbar">
          <Tag size={14} className="text-muted-foreground shrink-0" />
          <button 
            onClick={() => setSelectedTag(null)}
            className={`text-[10px] px-3 py-1 rounded-full border transition-all shrink-0 ${!selectedTag ? 'bg-accent/20 border-accent text-accent' : 'bg-white/5 border-white/5 text-muted-foreground hover:bg-white/10'}`}
          >
            All
          </button>
          {allTags.map(tag => (
            <button 
              key={tag}
              onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
              className={`text-[10px] px-3 py-1 rounded-full border transition-all shrink-0 ${selectedTag === tag ? 'bg-accent/20 border-accent text-accent' : 'bg-white/5 border-white/5 text-muted-foreground hover:bg-white/10'}`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {batchStatus && (
        <div className="mb-6 animate-slide-down">
          <div className="flex justify-between text-xs font-bold text-accent mb-2">
            <span>{batchStatus.title}: {batchStatus.currentModName}</span>
            <span>{batchStatus.progress}%</span>
          </div>
          <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
            <div className="h-full bg-accent transition-all duration-300 shadow-[0_0_10px_rgba(var(--color-accent-rgb),0.5)]" style={{ width: `${batchStatus.progress}%` }} />
          </div>
        </div>
      )}

      {/* Main Drag-n-Drop Area */}
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex gap-6 flex-1 min-h-0 overflow-hidden">
          
          {/* LEFT COLUMN: Library (Inactive) */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex items-center justify-between mb-2 px-2">
              <h2 className="text-lg font-bold flex items-center gap-2">
                Inactive Mods <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full">{filteredInactive.length}</span>
              </h2>
              <button onClick={enableAll} className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-accent transition-colors px-2 py-1 bg-white/5 rounded">Enable All</button>
            </div>
            <Droppable droppableId="inactive">
              {(provided, snapshot) => (
                <div 
                  {...provided.droppableProps}
                  ref={provided.innerRef}
                  className={`flex-1 overflow-y-auto pr-2 custom-scrollbar transition-colors rounded-xl border-2 border-dashed ${snapshot.isDraggingOver ? 'bg-accent/5 border-accent/40' : 'border-transparent'}`}
                >
                  <div className="flex flex-col gap-2 p-1">
                    {filteredInactive.map((mod, index) => (
                      <ModCard key={mod.id} mod={mod} index={index} modSizes={modSizes} formatSize={formatSize} onRefresh={onRefresh} />
                    ))}
                    {provided.placeholder}
                  </div>
                </div>
              )}
            </Droppable>
          </div>

          {/* MIDDLE: Transfer Buttons (Optional but nice) */}
          <div className="flex flex-col justify-center gap-4">
            <div className="p-2 rounded-full bg-white/5 border border-white/10 opacity-30">
              <ChevronRight size={24} />
            </div>
            <div className="p-2 rounded-full bg-white/5 border border-white/10 opacity-30">
              <ChevronLeft size={24} />
            </div>
          </div>

          {/* RIGHT COLUMN: Load Order (Active) */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex items-center justify-between mb-2 px-2">
              <h2 className="text-lg font-bold flex items-center gap-2">
                Active Load Order <span className="text-xs bg-accent/20 text-accent px-2 py-0.5 rounded-full">{filteredActive.length}</span>
              </h2>
              <div className="flex items-center gap-2">
                <button onClick={disableAll} className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-red-400 transition-colors px-2 py-1 bg-white/5 rounded">Disable All</button>
                <button className="text-xs text-muted-foreground hover:text-accent transition-colors" onClick={() => invoke("apply_auto_sort", { activeIds: localActive.map(m => m.id) }).then(() => onRefresh())}>⚡ Auto-Sort</button>
              </div>
            </div>
            <Droppable droppableId="active">
              {(provided, snapshot) => (
                <div 
                  {...provided.droppableProps}
                  ref={provided.innerRef}
                  className={`flex-1 overflow-y-auto pr-2 custom-scrollbar transition-colors rounded-xl border-2 border-dashed ${snapshot.isDraggingOver ? 'bg-accent/10 border-accent/60' : 'border-accent/10'}`}
                >
                  <div className="flex flex-col gap-2 p-1">
                    {filteredActive.map((mod, index) => (
                      <ModCard key={mod.id} mod={mod} index={index} modSizes={modSizes} formatSize={formatSize} onRefresh={onRefresh} isActive />
                    ))}
                    {provided.placeholder}
                  </div>
                </div>
              )}
            </Droppable>
          </div>

        </div>
      </DragDropContext>
    </div>
  );
}

const ModCard = memo(({ mod, index, modSizes, formatSize, onRefresh, isActive }: { 
  mod: ModInfo; index: number; modSizes: any; formatSize: any; onRefresh: () => void; isActive?: boolean 
}) => {
  const [addingTag, setAddingTag] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [editingNote, setEditingNote] = useState(false);
  const [noteValue, setNoteValue] = useState(mod.custom_note || "");

  const handleAddTag = async () => {
    if (!newTag.trim()) { setAddingTag(false); return; }
    const tags = [...(mod.custom_tags || []), newTag.trim()];
    await invoke("set_mod_tags", { id: mod.id, tags });
    setNewTag("");
    setAddingTag(false);
    onRefresh();
  };

  const removeTag = async (tag: string) => {
    const tags = mod.custom_tags.filter(t => t !== tag);
    await invoke("set_mod_tags", { id: mod.id, tags });
    onRefresh();
  };

  const handleSaveNote = async () => {
    await invoke("set_mod_note", { id: mod.id, note: noteValue });
    setEditingNote(false);
    onRefresh();
  };

  return (
    <Draggable draggableId={mod.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`glass-card p-3 flex flex-col gap-2 group transition-all duration-200 ${
            snapshot.isDragging ? 'shadow-2xl border-accent/50 scale-[1.02] ring-2 ring-accent/30 z-50' : 'hover:border-white/20'
          }`}
          style={{ 
            ...provided.draggableProps.style,
            willChange: "transform, opacity",
          }}
        >
          <div className="flex items-center gap-3">
            {isActive && (
              <div className="w-8 h-8 flex items-center justify-center bg-accent/20 rounded-md text-[10px] font-black text-accent shrink-0">
                {index + 1}
              </div>
            )}
            
            <div className="w-12 h-12 rounded-lg bg-black/40 flex-shrink-0 overflow-hidden relative border border-white/5 shadow-inner">
              {_imgCache[mod.id] ? (
                <img src={_imgCache[mod.id]} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center opacity-30"><Folder size={20} /></div>
              )}
              {!mod.enabled && <div className="absolute inset-0 bg-black/60 backdrop-grayscale-[1]" />}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-0.5">
                <div className="flex flex-col min-w-0">
                  <h3 className={`text-sm font-bold truncate flex items-center gap-1.5 ${mod.enabled ? 'text-white' : 'text-muted-foreground'}`}>
                    {mod.name}
                    {mod.workshop_name && (
                      <span title={`Workshop Title: ${mod.workshop_name}`} className="inline-flex items-center text-[8px] bg-blue-500/20 text-blue-400 px-1 rounded uppercase font-black">
                        Steam
                      </span>
                    )}
                    {mod.custom_tags?.includes("Third-Party") && (
                      <span className="inline-flex items-center text-[8px] bg-purple-500/20 text-purple-400 px-1 rounded uppercase font-black">
                        External
                      </span>
                    )}
                    {mod.custom_tags?.includes("RJW Ecosystem") && (
                      <span className="inline-flex items-center text-[8px] bg-pink-500/30 text-pink-400 px-1 rounded uppercase font-black animate-pulse">
                        RJW
                      </span>
                    )}
                    {mod.created_at > 0 && mod.source !== 'official' && (Date.now() / 1000 - mod.created_at) < 86400 && (
                      <span className="inline-flex items-center text-[8px] bg-yellow-400 text-black px-1 rounded uppercase font-black animate-pulse shadow-[0_0_12px_rgba(250,204,21,0.6)] border border-white/40">
                        NEW
                      </span>
                    )}
                  </h3>
                  {mod.workshop_name && mod.workshop_name !== mod.name && (
                    <p className="text-[9px] text-blue-400/80 font-medium truncate mt-[-1px]">WS: {mod.workshop_name}</p>
                  )}
                  {mod.custom_note && !editingNote && (
                    <p className="text-[10px] text-accent/80 italic truncate mt-[-2px]">{mod.custom_note}</p>
                  )}
                </div>
                {modSizes[mod.id] && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${modSizes[mod.id].assets > 100000000 ? 'bg-red-500/20 text-red-400' : 'bg-white/5 text-muted-foreground'}`}>
                    🖼️ {formatSize(modSizes[mod.id].assets)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 overflow-hidden">
                <span className={`text-[8px] uppercase font-black px-1 rounded border ${
                  mod.source === 'workshop' ? 'border-blue-500/30 text-blue-400 bg-blue-500/5' : 
                  mod.source === 'local' ? 'border-green-500/30 text-green-400 bg-green-500/5' : 
                  'border-orange-500/30 text-orange-400 bg-orange-500/5'
                }`}>
                  {mod.source}
                </span>
                <span className="text-[10px] text-muted-foreground truncate opacity-60">by {mod.author || 'Unknown'}</span>
              </div>
            </div>

            <div className="flex flex-col items-end shrink-0">
              <span className="text-[10px] font-mono opacity-40">{formatSize(mod.size_bytes)}</span>
              <div className="flex gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button className={`p-1 rounded ${editingNote ? 'text-accent bg-accent/20' : 'hover:bg-white/10'}`} title="Edit Note" onClick={(e) => { e.stopPropagation(); setEditingNote(!editingNote); }}>
                    <StickyNote size={12} />
                  </button>
                  <button className="p-1 hover:bg-white/10 rounded" title="Open Folder" onClick={(e) => { e.stopPropagation(); invoke("open_path_or_url", { target: mod.path }); }}><Folder size={12} /></button>
                  <button className="p-1 hover:bg-red-500/20 text-red-400 rounded" title="Delete Mod" onClick={(e) => { e.stopPropagation(); if(confirm(`Delete ${mod.name}?`)) invoke("delete_mod", { id: mod.id }); }}><Trash2 size={12} /></button>
              </div>
            </div>
          </div>

          {editingNote && (
             <div className="px-1 animate-in fade-in slide-in-from-top-1">
               <input 
                 autoFocus
                 className="w-full bg-black/40 border border-accent/30 rounded px-2 py-1 text-[10px] outline-none focus:border-accent shadow-inner"
                 placeholder="Write a private note for this mod..."
                 value={noteValue}
                 onChange={e => setNoteValue(e.target.value)}
                 onBlur={handleSaveNote}
                 onKeyDown={e => e.key === 'Enter' && handleSaveNote()}
               />
             </div>
          )}

          {/* Tags Section */}
          <div className="flex flex-wrap items-center gap-1.5 mt-1 border-t border-white/5 pt-2">
            {mod.custom_tags?.map(t => (
              <span key={t} className="flex items-center gap-1 text-[9px] bg-accent/10 text-accent border border-accent/20 px-1.5 py-0.5 rounded-md group/tag">
                {t}
                <button onClick={() => removeTag(t)} className="opacity-0 group-hover/tag:opacity-100 transition-opacity hover:text-red-400">
                  <X size={10} />
                </button>
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
              <button 
                onClick={() => setAddingTag(true)}
                className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-accent bg-white/5 hover:bg-accent/10 px-1.5 py-0.5 rounded-md transition-colors"
              >
                <Plus size={10} /> Tag
              </button>
            )}
          </div>
        </div>
      )}
    </Draggable>
  );
});
