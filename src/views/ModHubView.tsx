import React, { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { 
  Download, 
  Search, 
  ExternalLink, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle,
  Package,
  Sparkles,
  ShieldCheck,
  LifeBuoy
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ModInfo, PerformanceLevel } from '../types';

interface HubProvider {
  name: string;
  display_name?: string;
  description?: string;
  url: string;
  authors?: string[];
  info_url?: string;
  branch?: string;
  disabled?: boolean;
}

interface HubManifest {
  providers: Record<string, Record<string, HubProvider>>;
}

import { Dependency } from '../types';
const PERFORMANCE_SEARCH_DEBOUNCE_MS = 180;
const ULTRA_SEARCH_DEBOUNCE_MS = 320;
const LARGE_HUB_THRESHOLD = 300;

interface Props {
  installedMods: ModInfo[];
  onRefresh: () => void;
  toast: (msg: string, type?: string) => void;
  performanceLevel: PerformanceLevel;
}

export const ModHubView: React.FC<Props> = ({ installedMods, onRefresh, toast, performanceLevel }) => {
  const { t } = useTranslation();
  const performanceMode = performanceLevel !== 'normal';
  const ultraPerformance = performanceLevel === 'ultra';
  const [manifest, setManifest] = useState<HubManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [installing, setInstalling] = useState<string | null>(null);
  const [missingDeps, setMissingDeps] = useState<{mod: string, missing: Dependency[]} | null>(null);

  const fetchHub = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<HubManifest>('fetch_mod_hub');
      setManifest(data);
    } catch (err: any) {
      setError(err.toString());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHub();
  }, []);

  useEffect(() => {
    const providerCount = manifest ? Object.values(manifest.providers).reduce((sum, group) => sum + Object.keys(group).length, 0) : 0;
    const debounceMs = ultraPerformance ? ULTRA_SEARCH_DEBOUNCE_MS : PERFORMANCE_SEARCH_DEBOUNCE_MS;
    const handle = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, providerCount > LARGE_HUB_THRESHOLD ? debounceMs : 0);

    return () => window.clearTimeout(handle);
  }, [searchQuery, manifest, ultraPerformance]);

  const normalize = (value: string) => value.toLowerCase().replace(/[-_\s]/g, '');

  const handleInstall = async (provider: HubProvider) => {
    setInstalling(provider.name);
    try {
      const missing = await invoke<Dependency[]>('install_hub_mod', { provider });
      await onRefresh();
      
      if (missing.length > 0) {
        setMissingDeps({ mod: provider.display_name || provider.name, missing });
        toast(`Installed ${provider.name}, but it's missing dependencies!`, "warning");
      } else {
        toast(`Successfully installed ${provider.name}`, "success");
      }
    } catch (err: any) {
      toast(`Failed to install: ${err}`, "error");
    } finally {
      setInstalling(null);
    }
  };

  const normalizedSearch = debouncedSearchQuery.toLowerCase();
  const categories = useMemo(() => manifest ? Object.keys(manifest.providers).sort() : [], [manifest]);
  const installedLookup = useMemo(() => {
    const lookup = new Set<string>();
    for (const mod of installedMods) {
      lookup.add(normalize(mod.name));
      lookup.add(normalize(mod.id));
      lookup.add(normalize(mod.path));
      lookup.add(normalize(mod.path.split(/[\\/]/).pop() || ""));
    }
    return lookup;
  }, [installedMods]);
  const filteredByCategory = useMemo(() => {
    if (!manifest) return {};

    return Object.fromEntries(
      Object.entries(manifest.providers).map(([category, providers]) => [
        category,
        Object.values(providers)
          .filter(m => !m.disabled)
          .filter(m =>
            m.name.toLowerCase().includes(normalizedSearch) ||
            (m.display_name || '').toLowerCase().includes(normalizedSearch) ||
            (m.description || '').toLowerCase().includes(normalizedSearch)
          ),
      ])
    ) as Record<string, HubProvider[]>;
  }, [manifest, normalizedSearch]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4 py-20">
        <RefreshCw className={`w-12 h-12 text-pink-500 ${performanceMode ? '' : 'animate-spin'}`} />
        <p className="text-xl font-medium text-gray-400">{t('mod_hub.loading_msg')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4 p-8">
        <AlertCircle className="w-16 h-16 text-red-500" />
        <p className="text-xl font-bold text-white">{t('mod_hub.error_loading')}</p>
        <p className="text-gray-400 text-center max-w-md">{error}</p>
        <button 
          onClick={fetchHub}
          className={`px-6 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-lg ${ultraPerformance ? '' : 'transition-colors'}`}
        >
          {t('mod_hub.try_again')}
        </button>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full overflow-hidden ${performanceMode ? '' : 'animate-in fade-in duration-500'}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 bg-gray-900/50 border-b border-white/10">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Sparkles className="text-pink-400" />
            RJW Mod Hub
            <span className="text-xs font-normal px-2 py-0.5 bg-pink-500/20 text-pink-300 border border-pink-500/30 rounded-full">
              {t('mod_hub.external')}
            </span>
          </h1>
          <p className="text-gray-400 mt-1">{t('mod_hub.hub_desc')}</p>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder={t('mod_hub.search_addons')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`pl-10 pr-4 py-2 bg-black/40 border border-white/10 rounded-lg text-white w-64 focus:outline-none focus:border-pink-500/50 ${ultraPerformance ? '' : 'transition-all'}`}
            />
          </div>
          <button 
            onClick={fetchHub}
            className={`p-2 hover:bg-white/5 rounded-lg text-gray-400 hover:text-white ${ultraPerformance ? '' : 'transition-colors'}`}
            title={t('common.refresh')}
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-8 space-y-10 custom-scrollbar">
        {categories.map(category => {
          const mods = filteredByCategory[category] || [];
          if (mods.length === 0) return null;

          return (
            <section key={category} className="space-y-4">
              <div className="flex items-center gap-2 border-l-4 border-pink-500 pl-3">
                <h2 className="text-lg font-bold text-white uppercase tracking-wider">
                  {category}
                </h2>
                <span className="text-xs text-gray-500 font-mono">({t('mod_hub.mods_count', { count: mods.length })})</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {mods.map(mod => (
                  <div 
                    key={mod.name} 
                    className={`group bg-gray-900/40 border border-white/5 rounded-xl p-5 relative overflow-hidden ${ultraPerformance ? '' : 'hover:border-pink-500/30 hover:bg-gray-800/60 transition-all duration-300'}`}
                  >
                    {!ultraPerformance && <div className="absolute inset-0 bg-gradient-to-br from-pink-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />}

                    <div className="relative flex flex-col h-full">
                      <div className="flex justify-between items-start mb-3">
                        <h3 className={`text-lg font-bold text-white ${ultraPerformance ? '' : 'group-hover:text-pink-300 transition-colors'}`}>
                          {mod.display_name || mod.name}
                        </h3>
                        <div className="flex gap-2">
                          {mod.info_url && (
                            <a 
                              href={mod.info_url} 
                              target="_blank" 
                              rel="noreferrer"
                              className={`p-1.5 text-gray-500 hover:text-white hover:bg-white/10 rounded-md ${ultraPerformance ? '' : 'transition-all'}`}
                              title="LoversLab"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          )}
                        </div>
                      </div>

                      <p className="text-sm text-gray-400 mb-4 line-clamp-3 flex-1 italic">
                        {mod.description || t('mod_hub.no_desc')}
                      </p>

                      <div className="flex items-center justify-between mt-auto pt-4 border-t border-white/5">
                        <div className="flex flex-col">
                          <span className="text-[10px] text-gray-500 uppercase tracking-tighter">{t('mod_hub.authors')}</span>
                          <span className="text-xs text-gray-300 truncate max-w-[120px]">
                            {mod.authors?.join(', ') || t('common.unknown')}
                          </span>
                        </div>

                        {(() => {
                          const hubName = normalize(mod.name);
                          const hubDisplay = mod.display_name ? normalize(mod.display_name) : hubName;
                          return installedLookup.has(hubName) ||
                            installedLookup.has(hubDisplay);
                        })() ? (
                          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 text-green-400 border border-green-500/20 rounded-lg text-sm">
                            <CheckCircle2 className="w-4 h-4" />
                            {t('mod_hub.installed')}
                          </div>
                        ) : (
                          <button
                            onClick={() => handleInstall(mod)}
                            disabled={!!installing}
                            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium ${ultraPerformance ? '' : 'transition-all'} ${
                              installing === mod.name
                                ? 'bg-gray-700 text-gray-400'
                                : 'bg-pink-600/20 text-pink-400 hover:bg-pink-600 hover:text-white border border-pink-500/30'
                            }`}
                          >
                            {installing === mod.name ? (
                              <>
                                <RefreshCw className={`w-4 h-4 ${ultraPerformance ? '' : 'animate-spin'}`} />
                                {t('mod_hub.installing')}
                              </>
                            ) : (
                              <>
                                <Download className="w-4 h-4" />
                                {t('mod_hub.install')}
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      
      {/* Dependency Warning Modal */}
      {missingDeps && (
        <div className={`fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm ${ultraPerformance ? '' : 'animate-in fade-in duration-300'}`}>
          <div className={`glass-card max-w-md w-full p-8 border-red-500/30 shadow-[0_0_50px_rgba(239,68,68,0.2)] ${ultraPerformance ? '' : 'animate-in zoom-in-95 duration-300'}`}>
            <div className="w-16 h-16 bg-red-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <LifeBuoy className={`w-10 h-10 text-red-500 ${ultraPerformance ? '' : 'animate-bounce'}`} />
            </div>
            <h3 className="text-2xl font-black text-center text-white mb-2 uppercase tracking-tighter">{t('mod_hub.dependency_guard')}</h3>
            <p className="text-gray-400 text-center text-sm mb-6">
              <span className="text-white font-bold">{missingDeps.mod}</span> {t('mod_hub.missing_deps_msg')}
            </p>
            
            <div className="bg-black/40 rounded-xl p-4 border border-white/5 mb-8">
              <ul className="space-y-2">
                {missingDeps.missing.map(dep => (
                  <li key={dep.package_id} className="flex items-center gap-2 text-red-300 font-mono text-xs">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500"></div>
                    {dep.display_name || dep.package_id}
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={() => setMissingDeps(null)}
                className={`py-3 px-4 bg-white/5 hover:bg-white/10 text-gray-400 font-bold rounded-xl uppercase text-xs tracking-widest ${ultraPerformance ? '' : 'transition-all'}`}
              >
                {t('mod_hub.ignore')}
              </button>
              <button 
                onClick={() => {
                  const first = missingDeps.missing[0];
                  setSearchQuery(first.display_name || first.package_id);
                  setMissingDeps(null);
                }}
                className={`py-3 px-4 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl shadow-lg shadow-red-600/20 uppercase text-xs tracking-widest ${ultraPerformance ? '' : 'transition-all'}`}
              >
                {t('mod_hub.find_deps')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer Info */}
      <div className="p-4 bg-black/40 border-t border-white/5 flex items-center justify-between text-xs text-gray-500">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <ShieldCheck className="w-3 h-3 text-green-500" />
            {t('mod_hub.footer_shield')}
          </span>
          <span className="flex items-center gap-1">
            <Package className="w-3 h-3 text-blue-500" />
            {t('mod_hub.footer_package')}
          </span>
        </div>
        <p>{t('mod_hub.footer_warning')}</p>
      </div>
    </div>
  );
};
