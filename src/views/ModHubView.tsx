import React, { useState, useEffect } from 'react';
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
  ShieldCheck
} from 'lucide-react';

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

export const ModHubView: React.FC = () => {
  const [manifest, setManifest] = useState<HubManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [installing, setInstalling] = useState<string | null>(null);
  const [installed, setInstalled] = useState<Set<string>>(new Set());

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

  const handleInstall = async (provider: HubProvider) => {
    setInstalling(provider.name);
    try {
      await invoke('install_hub_mod', { provider });
      setInstalled(prev => new Set(prev).add(provider.name));
    } catch (err: any) {
      alert(`Failed to install: ${err}`);
    } finally {
      setInstalling(null);
    }
  };

  const categories = manifest ? Object.keys(manifest.providers).sort() : [];
  
  const filteredMods = (category: string) => {
    if (!manifest) return [];
    return Object.values(manifest.providers[category])
      .filter(m => !m.disabled)
      .filter(m => 
        m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.display_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.description || '').toLowerCase().includes(searchQuery.toLowerCase())
      );
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4 py-20">
        <RefreshCw className="w-12 h-12 text-pink-500 animate-spin" />
        <p className="text-xl font-medium text-gray-400">Đang nạp "bí kíp" từ LoversLab...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4 p-8">
        <AlertCircle className="w-16 h-16 text-red-500" />
        <p className="text-xl font-bold text-white">Lỗi nạp dữ liệu</p>
        <p className="text-gray-400 text-center max-w-md">{error}</p>
        <button 
          onClick={fetchHub}
          className="px-6 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-lg transition-colors"
        >
          Thử lại
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between p-6 bg-gray-900/50 border-b border-white/10">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Sparkles className="text-pink-400" />
            RJW Mod Hub
            <span className="text-xs font-normal px-2 py-0.5 bg-pink-500/20 text-pink-300 border border-pink-500/30 rounded-full">
              EXTERNAL
            </span>
          </h1>
          <p className="text-gray-400 mt-1">Khám phá và cài đặt các bản Mod "tà đạo" từ hệ sinh thái LoversLab.</p>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Tìm kiếm Add-on..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 bg-black/40 border border-white/10 rounded-lg text-white w-64 focus:outline-none focus:border-pink-500/50 transition-all"
            />
          </div>
          <button 
            onClick={fetchHub}
            className="p-2 hover:bg-white/5 rounded-lg text-gray-400 hover:text-white transition-colors"
            title="Làm mới danh sách"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-10 custom-scrollbar">
        {categories.map(category => {
          const mods = filteredMods(category);
          if (mods.length === 0) return null;

          return (
            <section key={category} className="space-y-4">
              <div className="flex items-center gap-2 border-l-4 border-pink-500 pl-3">
                <h2 className="text-lg font-bold text-white uppercase tracking-wider">
                  {category}
                </h2>
                <span className="text-xs text-gray-500 font-mono">({mods.length} mods)</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {mods.map(mod => (
                  <div 
                    key={mod.name} 
                    className="group bg-gray-900/40 border border-white/5 hover:border-pink-500/30 hover:bg-gray-800/60 rounded-xl p-5 transition-all duration-300 relative overflow-hidden"
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-pink-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

                    <div className="relative flex flex-col h-full">
                      <div className="flex justify-between items-start mb-3">
                        <h3 className="text-lg font-bold text-white group-hover:text-pink-300 transition-colors">
                          {mod.display_name || mod.name}
                        </h3>
                        <div className="flex gap-2">
                          {mod.info_url && (
                            <a 
                              href={mod.info_url} 
                              target="_blank" 
                              rel="noreferrer"
                              className="p-1.5 text-gray-500 hover:text-white hover:bg-white/10 rounded-md transition-all"
                              title="Xem trên LoversLab"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          )}
                        </div>
                      </div>

                      <p className="text-sm text-gray-400 mb-4 line-clamp-3 flex-1 italic">
                        {mod.description || "Không có mô tả."}
                      </p>

                      <div className="flex items-center justify-between mt-auto pt-4 border-t border-white/5">
                        <div className="flex flex-col">
                          <span className="text-[10px] text-gray-500 uppercase tracking-tighter">Authors</span>
                          <span className="text-xs text-gray-300 truncate max-w-[120px]">
                            {mod.authors?.join(', ') || 'Unknown'}
                          </span>
                        </div>

                        {installed.has(mod.name) ? (
                          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 text-green-400 border border-green-500/20 rounded-lg text-sm">
                            <CheckCircle2 className="w-4 h-4" />
                            Đã cài
                          </div>
                        ) : (
                          <button
                            onClick={() => handleInstall(mod)}
                            disabled={!!installing}
                            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                              installing === mod.name
                                ? 'bg-gray-700 text-gray-400'
                                : 'bg-pink-600/20 text-pink-400 hover:bg-pink-600 hover:text-white border border-pink-500/30'
                            }`}
                          >
                            {installing === mod.name ? (
                              <>
                                <RefreshCw className="w-4 h-4 animate-spin" />
                                Installing...
                              </>
                            ) : (
                              <>
                                <Download className="w-4 h-4" />
                                Install
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

      {/* Footer Info */}
      <div className="p-4 bg-black/40 border-t border-white/5 flex items-center justify-between text-xs text-gray-500">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <ShieldCheck className="w-3 h-3 text-green-500" />
            Dữ liệu từ Libidinous Loader Providers
          </span>
          <span className="flex items-center gap-1">
            <Package className="w-3 h-3 text-blue-500" />
            Tự động tải từ GitGud/GitHub
          </span>
        </div>
        <p>Bản Mod này có thể không an toàn hoặc chứa nội dung nhạy cảm. Hãy tự chịu trách nhiệm.</p>
      </div>
    </div>
  );
};
