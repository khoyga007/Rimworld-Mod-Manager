import { useTranslation } from "react-i18next";
import { 
  BookOpen, 
  Settings, 
  Package, 
  ListOrdered, 
  Zap, 
  FolderHeart, 
  AlertCircle,
  ExternalLink,
  ChevronRight,
  Info
} from "lucide-react";

export default function GuideView() {
  const { t } = useTranslation();

  const sections = [
    {
      id: "setup",
      icon: <Settings className="text-blue-400" />,
      title: t('guide.setup_title'),
      desc: t('guide.setup_desc'),
      content: t('guide.setup_content'),
      color: "blue"
    },
    {
      id: "mods",
      icon: <Package className="text-emerald-400" />,
      title: t('guide.mods_title'),
      desc: t('guide.mods_desc'),
      content: t('guide.mods_content'),
      color: "emerald"
    },
    {
      id: "loadorder",
      icon: <ListOrdered className="text-purple-400" />,
      title: t('guide.order_title'),
      desc: t('guide.order_desc'),
      content: t('guide.order_content'),
      color: "purple"
    },
    {
      id: "optimize",
      icon: <Zap className="text-amber-400" />,
      title: t('guide.opti_title'),
      desc: t('guide.opti_desc'),
      content: t('guide.opti_content'),
      color: "amber"
    },
    {
      id: "presets",
      icon: <FolderHeart className="text-pink-400" />,
      title: t('guide.presets_title'),
      desc: t('guide.presets_desc'),
      content: t('guide.presets_content'),
      color: "pink"
    },
    {
      id: "trouble",
      icon: <AlertCircle className="text-red-400" />,
      title: t('guide.trouble_title'),
      desc: t('guide.trouble_desc'),
      content: t('guide.trouble_content'),
      color: "red"
    }
  ];

  return (
    <div className="animate-fade-in p-8 overflow-y-auto custom-scrollbar h-full bg-background/50">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-12 border-b border-white/5 pb-8">
          <div className="p-4 bg-accent/10 rounded-2xl text-accent shadow-2xl shadow-accent/20">
            <BookOpen size={48} strokeWidth={1.5} />
          </div>
          <div>
            <h1 className="text-4xl font-black uppercase tracking-tighter text-white mb-2">
              {t('guide.hero_title')}
            </h1>
            <p className="text-muted-foreground text-lg max-w-2xl leading-relaxed">
              {t('guide.hero_subtitle')}
            </p>
          </div>
        </div>

        {/* Quick Tips Ribbon */}
        <div className="flex gap-4 mb-12 overflow-x-auto no-scrollbar pb-2">
          <div className="flex-none flex items-center gap-3 bg-blue-500/10 border border-blue-500/20 px-4 py-3 rounded-xl">
             <Info size={18} className="text-blue-400" />
             <span className="text-xs font-bold text-blue-200 uppercase tracking-widest">{t('guide.tip_save')}</span>
          </div>
          <div className="flex-none flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 rounded-xl">
             <Zap size={18} className="text-emerald-400" />
             <span className="text-xs font-bold text-emerald-200 uppercase tracking-widest">{t('guide.tip_drag')}</span>
          </div>
          <div className="flex-none flex items-center gap-3 bg-purple-500/10 border border-purple-500/20 px-4 py-3 rounded-xl">
             <ListOrdered size={18} className="text-purple-400" />
             <span className="text-xs font-bold text-purple-200 uppercase tracking-widest">{t('guide.tip_rules')}</span>
          </div>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {sections.map((s) => (
            <div key={s.id} className="glass-card group hover:border-accent/30 transition-all duration-300 flex flex-col overflow-hidden">
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className={`p-3 bg-${s.color}-500/10 rounded-xl`}>
                    {s.icon}
                  </div>
                  <ChevronRight size={18} className="text-white/10 group-hover:text-accent transition-colors" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2 group-hover:text-accent transition-colors">
                  {s.title}
                </h3>
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-4 opacity-70">
                  {s.desc}
                </p>
                <div className="text-sm text-muted-foreground leading-relaxed space-y-2 whitespace-pre-line border-t border-white/5 pt-4">
                  {s.content}
                </div>
              </div>
              <div className={`h-1 w-full bg-${s.color}-500/20 mt-auto`}>
                 <div className={`h-full bg-${s.color}-500 w-0 group-hover:w-full transition-all duration-500`} />
              </div>
            </div>
          ))}
        </div>

        {/* External Links */}
        <div className="mt-16 p-8 bg-black/40 rounded-3xl border border-white/5 flex flex-col items-center text-center">
           <h3 className="text-2xl font-black uppercase tracking-tighter text-white mb-4">
             {t('guide.community_title')}
           </h3>
           <p className="text-muted-foreground max-w-xl mb-8">
             {t('guide.community_desc')}
           </p>
           <div className="flex flex-wrap justify-center gap-4">
              <a href="https://rimpy.website" target="_blank" className="btn-secondary flex items-center gap-2 px-6 py-3">
                RimPy Database <ExternalLink size={14} />
              </a>
              <a href="https://steamcommunity.com/app/294100/workshop/" target="_blank" className="btn-secondary flex items-center gap-2 px-6 py-3">
                Steam Workshop <ExternalLink size={14} />
              </a>
           </div>
        </div>

        <footer className="mt-16 text-center text-[10px] text-muted-foreground uppercase tracking-[0.2em] opacity-30 pb-16">
           RimPro Mod Manager • Advanced Agentic Coding Deepmind System
        </footer>
      </div>
    </div>
  );
}
