import { useState, useEffect } from "react";
import { X, AlertCircle, HelpCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

interface CustomDialogProps {
  isOpen: boolean;
  type: "confirm" | "prompt";
  title: string;
  message: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (value?: string) => void;
  onCancel: () => void;
}

export default function CustomDialog({
  isOpen,
  type,
  title,
  message,
  defaultValue = "",
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel
}: CustomDialogProps) {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState(defaultValue);

  useEffect(() => {
    if (isOpen) setInputValue(defaultValue);
  }, [isOpen, defaultValue]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="glass-card w-full max-w-md overflow-hidden shadow-2xl border-white/10 animate-scale-up">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/5 bg-white/5">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${type === 'confirm' ? 'bg-amber-500/10 text-amber-400' : 'bg-blue-500/10 text-blue-400'}`}>
              {type === 'confirm' ? <HelpCircle size={20} /> : <AlertCircle size={20} />}
            </div>
            <h3 className="text-lg font-bold text-white tracking-tight">{title}</h3>
          </div>
          <button 
            onClick={onCancel}
            className="p-2 hover:bg-white/10 rounded-full text-muted-foreground transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
            {message}
          </p>

          {type === "prompt" && (
            <div className="relative group">
              <input
                autoFocus
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onConfirm(inputValue);
                  if (e.key === "Escape") onCancel();
                }}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30 transition-all"
                placeholder={t('common.enter_here') || "..."}
              />
              <div className="absolute inset-0 rounded-xl bg-accent/5 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity" />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 bg-white/5 border-t border-white/5">
          <button 
            onClick={onCancel}
            className="btn-secondary px-5 py-2 text-xs font-bold uppercase tracking-widest"
          >
            {cancelLabel || t('common.cancel')}
          </button>
          <button 
            onClick={() => onConfirm(type === "prompt" ? inputValue : undefined)}
            className="btn-primary px-6 py-2 text-xs font-bold uppercase tracking-widest shadow-lg shadow-accent/20"
          >
            {confirmLabel || t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
