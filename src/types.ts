export interface Dependency {
  package_id: string;
  display_name?: string;
}

export interface CustomTag {
  label: string;
  color?: string | null;
}

export interface ModInfo {
  id: string;
  name: string;
  author: string;
  version?: string;
  supported_version?: string;
  tags: string[];
  custom_tags: CustomTag[];
  custom_note: string;
  workshop_name?: string;
  created_at: number;
  dependencies: Dependency[];
  load_after: string[];
  load_before: string[];
  incompatible_with: string[];
  missing_dependencies: Dependency[];
  picture?: string;
  path: string;
  descriptor_path: string;
  remote_file_id?: string;
  source: "official" | "workshop" | "local" | "other";
  enabled: boolean;
  load_order: number;
  size_bytes: number;
  duplicate_id: boolean;
}

export interface RimWorldPaths {
  config_dir: string;
  mods_config_path: string;
  game_dir?: string;
}

export interface DownloadProgress {
  workshop_id: string;
  status: string; // Made generic to support backend values flexibly
  progress: number;
  message: string;
  title?: string;
  preview_url?: string;
}

export interface Preset {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  mod_ids: string[];
  note?: string;
}

export type PerformanceLevel = "normal" | "performance" | "ultra";

export interface AppSettings {
  performanceLevel: PerformanceLevel;
  disableThumbnails: boolean;
  autoSuggestPerformanceMode: boolean;
  dismissedPerformanceSuggestion: boolean;
  autoUpdateMods: boolean;
}

export type LoadOrderIssue =
  | { kind: "MissingDependency"; mod_id: string; mod_name: string; missing: string }
  | { kind: "Cycle"; mod_ids: string[]; mod_names: string[] }
  | { kind: "OutOfOrder"; mod_id: string; mod_name: string; current_index: number; suggested_index: number }
  | { kind: "Incompatible"; mod_id: string; mod_name: string; conflicting_id: string; conflicting_name: string };

export interface ModPlan {
  mod_id: string;
  mod_name: string;
  suggested_index: number;
  current_index: number | null;
  bucket: string;
  reason: string;
}

export interface LoadOrderAnalysis {
  suggested: string[];
  plan: ModPlan[];
  issues: LoadOrderIssue[];
}

export interface SortPreview {
  current: string[];
  suggested: string[];
}

export interface LogPayload {
  path: string;
  content: string;
}

export interface UpdateStatus {
  mod_id: string;
  remote_file_id: string;
  local_time: number;
  remote_time: number;
  has_update: boolean;
  title: string;
}

export interface SaveGameInfo {
  file_name: string;
  colony_name: string;
  seed: string;
  game_version: string;
  mod_ids: string[];
  mod_names: string[];
  save_date: string;
  file_size: number;
}

export interface MissingSaveMod {
  id: string;
  name: string;
}

export interface SaveAnalysis {
  save: SaveGameInfo;
  missing_mods: MissingSaveMod[];
  present_mods: string[];
}
